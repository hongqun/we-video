#!/usr/bin/env python3
"""把线稿和彩图编译成不可变图层、显现时间图和画笔路径；不执行视频渲染。"""
import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "vendor"))
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from line_first import register, move, luminance, MIN_KEPT, MAX_ADDED, MAX_SHIFT
from line_topology import extract_strokes, cover_ink_edges
from choreography import ordered_strokes, construction, densify, path_times, sweeps, to_render, to_plan

# 补画局部实心墨迹后使用独立缓存，重新处理不会复用旧轨迹。
VERSION = "handdraw-6"


def clean_line_gray(gray):
    # 只保留与真实黑色墨迹相连的抗锯齿边缘，白纸上的浅灰像素不是独立笔画。
    labels, _ = ndimage.label(gray < 245, structure=np.ones((3, 3)))
    supported = np.bincount(labels[gray < 150], minlength=int(labels.max()) + 1) > 0
    supported[0] = False
    return np.where(supported[labels], gray, 255.)


def paint_mask(paint, gray):
    """只清理墨线和孤立噪点，不改动真实填色像素。"""
    mask = (paint.min(axis=2) < 247) & ~(gray < 245)
    labels, _ = ndimage.label(mask)
    sizes = np.bincount(labels.ravel())
    near_ink = ndimage.distance_transform_edt(~(gray < 245))
    neutral = np.ptp(paint.astype(int), axis=2) < 20
    # 一两个像素的中性噪点和墨线边缘不再被当成独立的马克笔颜色。
    mask &= ~((sizes[labels] < 8) & ((near_ink <= 3) | neutral))
    return mask


def paint_regions(paint, gray):
    """按相邻像素的色差分区，渐变共用笔道，输出仍保留原始颜色。"""
    mask = paint_mask(paint, gray)
    labels, _ = ndimage.label(mask)
    regions = []
    for component, box in enumerate(ndimage.find_objects(labels), 1):
        if box is None:
            continue
        inside = labels[box] == component
        colors = paint[box].astype(np.int16)
        owners = np.zeros(inside.shape, np.int32)
        ids = np.full(inside.shape, -1, np.int32)
        size = int(inside.sum())
        ids[inside] = np.arange(size)
        # 只连接四邻域中颜色接近的像素；不按固定 RGB 档位切开平滑渐变。
        horizontal = inside[:, :-1] & inside[:, 1:] & (np.abs(colors[:, :-1] - colors[:, 1:]).max(axis=2) <= 32)
        vertical = inside[:-1] & inside[1:] & (np.abs(colors[:-1] - colors[1:]).max(axis=2) <= 32)
        starts = np.r_[ids[:, :-1][horizontal], ids[:-1][vertical]]
        ends = np.r_[ids[:, 1:][horizontal], ids[1:][vertical]]
        graph = coo_matrix((np.ones(len(starts), np.uint8), (starts, ends)), shape=(size, size)).tocsr()
        _, assignments = connected_components(graph, directed=False)
        owners[inside] = assignments + 1
        counts = np.bincount(owners[inside])
        # 大物体内的小纹理也归并，但始终限制在同一连通区域内。
        minimum = max(32, min(128, math.ceil(size * .002)))
        major = counts >= minimum
        major[0] = False
        if not major.any():
            major[int(np.argmax(counts))] = True
        owners[~major[owners]] = 0
        if np.any(inside & (owners == 0)):
            nearest = ndimage.distance_transform_edt(owners == 0, return_distances=False, return_indices=True)
            owners[inside] = owners[nearest[0][inside], nearest[1][inside]]
        for owner in np.unique(owners[inside]):
            ys, xs = np.where((owners == owner) & inside)
            if not len(xs):
                continue
            ys += box[0].start
            xs += box[1].start
            # 代表色仅用于换笔排序，不参与像素归属，也不重涂原图。
            representative = np.median(paint[ys, xs], axis=0).astype(int) // 32
            code = int(representative @ [64, 8, 1])
            regions.append((float(luminance(paint[ys, xs]).mean()), ys, xs, code))
            if len(regions) > 12000:
                raise ValueError("彩图色块过碎；请使用少量平涂颜色，去掉纹理和渐变")
    return mask, regions


def color_layer(paint, gray, edge_margin):
    """从轮廓同侧的底色修复边缘，再将颜色延伸到墨线下面。"""
    ink = gray < 245
    mask = paint_mask(paint, gray)
    colors = np.where(mask[..., None], paint, 255).astype(np.uint8)
    depth = ndimage.distance_transform_edt(~ink)
    paper, _ = ndimage.label(~ink)
    light_or_color = (luminance(paint) >= 110) | (np.ptp(paint.astype(int), axis=2) >= 70)
    for component, box in enumerate(ndimage.find_objects(paper), 1):
        if box is None:
            continue
        inside = paper[box] == component
        local_depth = depth[box]
        # 狭小闭合区域使用自身深度，避免交通灯、眼睛等小色区被整个抹掉。
        safe = inside & (local_depth >= min(edge_margin, local_depth[inside].max() * .5))
        parts, _ = ndimage.label(mask[box] & inside)
        for part, part_box in enumerate(ndimage.find_objects(parts), 1):
            if part_box is None:
                continue
            piece = parts[part_box] == part
            if (safe[part_box] & piece).any():
                continue
            # 开放轮廓旁的细小彩色笔触也保留锚点，重复黑线不作为底色来源。
            candidates = piece & light_or_color[box][part_box]
            if candidates.any():
                safe[part_box] |= candidates & (local_depth[part_box] >= local_depth[part_box][candidates].max())
        edge = inside & ~safe
        if edge.any():
            nearest = ndimage.distance_transform_edt(~safe, return_distances=False, return_indices=True)
            local_colors = colors[box]
            local_colors[edge] = local_colors[nearest[0][edge], nearest[1][edge]]
    # 墨线覆盖底色；两侧先独立修复，白背景不会被另一侧的颜色扩散污染。
    if ink.any():
        nearest = ndimage.distance_transform_edt(ink, return_distances=False, return_indices=True)
        colors[ink] = colors[nearest[0][ink], nearest[1][ink]]
    alpha = (colors.min(axis=2) < 247).astype(np.uint8) * 255
    return np.dstack([colors, alpha])


def load_white(file):
    image = Image.open(file).convert("RGBA")
    paper = Image.new("RGBA", image.size, "white")
    paper.alpha_composite(image)
    return paper.convert("RGB")


def time_png(values, file, size):
    # 三字节无损存储毫秒；透明像素为未使用位置，不能经过 JPEG 或调色处理。
    valid = np.isfinite(values)
    ticks = np.where(valid, np.ceil(values), 0).astype(np.uint32)
    pixels = np.stack([ticks & 255, (ticks >> 8) & 255, (ticks >> 16) & 255, valid * 255], axis=-1).astype(np.uint8)
    Image.fromarray(pixels).resize(size, Image.Resampling.NEAREST).save(file)


def run(line_path, color_path, output, cache_key):
    line = load_white(line_path)
    color = load_white(color_path)
    if line.size != color.size:
        raise ValueError("线稿与上色图尺寸不一致；请以原线稿为输入重新上色，保持尺寸")
    line.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    color = color.resize(line.size, Image.Resampling.LANCZOS)
    plan = line.copy()
    plan.thumbnail((720, 720), Image.Resampling.LANCZOS)
    w, h = plan.size
    rgb = np.array(plan)
    gray = clean_line_gray(luminance(rgb))
    ink = gray < 150
    if ink.sum() < 30 or ink.mean() > .25:
        raise ValueError("线稿为空或包含大片填充；请使用纯白底简洁线稿，局部实心箭头等可保留，避免大片涂黑")
    if np.mean(np.ptp(rgb.astype(int), axis=2) > 35) > .01:
        raise ValueError("线稿含有彩色区域；请上传纯黑白线稿")
    moved, _, measures = register(rgb, np.array(color.resize(plan.size).convert("RGBA")))
    dy, dx = measures["shift_px"]
    if measures["kept_lines"] < MIN_KEPT or measures["added_line_share"] > MAX_ADDED or max(abs(dx), abs(dy)) > MAX_SHIFT * max(w, h):
        raise ValueError(f"上色图与线稿不匹配（保留线条 {measures['kept_lines']:.1%}，新增线条 {measures['added_line_share']:.1%}）；请附上原线稿，只上色，不移动或重画线条")
    strokes, _, _, stats = extract_strokes(ink)
    if not strokes or len(strokes) > 1500:
        raise ValueError("线稿无法提取或笔画过多；请减少纹理和细节后重新上传")
    # 箭头尖、眼罩等局部填黑允许保留；沿墨迹补画，避免远离笔尖的像素整块跳现。
    # 使用可见墨迹作通路，补画不穿过白纸，增加的路径也参与后续时长预算。
    stats["ink_coverage_visits"] = cover_ink_edges(strokes, gray < 245, maximum=10.)
    if len(strokes) > 1500 or sum(len(stroke["points"]) for stroke in strokes) > 500000:
        raise ValueError("整图绘制过于复杂；请减少对象、线条和色块")
    out = Path(output)
    out.mkdir(parents=True, exist_ok=True)
    scale = np.array([line.width / w, line.height / h])
    now, points, samples, sample_times = 50., [], [], []
    tip = np.array([0., 0.])

    def path(points_xy, speed, phase):
        nonlocal now, tip
        xy = densify(points_xy)
        # 抬笔也采样缓动路径，播放器线性插值即可保持与显现图一致。
        gap = max(60., np.linalg.norm(xy[0] - tip) / 2.)
        travel_start = now
        for fraction in np.linspace(0, 1, max(3, math.ceil(gap / 15))):
            ease = fraction * fraction * (3 - 2 * fraction)
            at = tip + (xy[0] - tip) * ease
            points.append([round(travel_start + gap * fraction, 3), float(at[0]), float(at[1]), 0])
        now += gap
        times = path_times(xy, speed, now)
        for time, at in zip(times, xy):
            points.append([round(float(time), 3), float(at[0]), float(at[1]), phase])
        now = float(times[-1]) + 35.
        tip = xy[-1]
        points.append([round(now, 3), float(tip[0]), float(tip[1]), 0])
        if now > 600000 or len(points) > 500000:
            raise ValueError("整图绘制过于复杂；请减少对象、线条和色块")
        return xy, times

    ordered, objects = ordered_strokes(strokes, ink)
    shapes = construction(objects)
    if not shapes:
        raise ValueError("线稿过于零碎，无法提取起形；请简化主体")
    sketch_alpha = np.zeros((line.height, line.width), np.uint8)
    sketch_times = np.full(sketch_alpha.shape, np.inf)
    # 起形保留独立透明图层，擦除不会改变真实墨迹或完成图。
    for shape in shapes:
        xy, times = path(shape, 1600., 3)
        rendered = to_render(xy, scale)
        layer = Image.new("L", line.size)
        ImageDraw.Draw(layer).line([tuple(point) for point in rendered], fill=110, width=max(1, round(1.4 * scale.mean())))
        mask = np.array(layer) > 0
        ys, xs = np.where(mask)
        _, nearest = cKDTree(rendered).query(np.c_[xs, ys])
        sketch_times[ys, xs] = np.minimum(sketch_times[ys, xs], times[nearest])
        sketch_alpha[mask] = 110
    sketch_end = now

    previous_object = None
    for stroke in ordered:
        # 模块切换留下思考停顿；预算压缩时仍归入抬笔成本。
        if previous_object is not None and previous_object != stroke["object"]:
            now += 100.
        previous_object = stroke["object"]
        xy, times = path(stroke["points"], 1100., 1)
        samples.extend(to_render(xy, scale).tolist())
        sample_times.extend(times.tolist())
    # 墨线和底色继续以原分辨率清理；显现时间也在此分辨率计算，不再放大格子。
    full_gray = clean_line_gray(np.array(line.convert("L")))
    aligned = move(np.array(color), round(dy * line.height / h), round(dx * line.width / w))
    alpha = 255 - full_gray
    line_rgba = np.zeros((line.height, line.width, 4), np.uint8)
    line_rgba[..., 3] = alpha
    color_rgba = color_layer(aligned, full_gray, edge_margin=2 * max(scale))
    full_mask, regions = paint_regions(color_rgba[..., :3], full_gray)
    if not full_mask.any():
        color_rgba[..., 3] = 0

    # 同一墨迹连通域只能引用本域的笔画，内部孤立点不会被其他对象提前显现。
    labels, _ = ndimage.label(alpha > 0, structure=np.ones((3, 3)))
    line_times = np.full(alpha.shape, np.inf)
    sample_array = np.asarray(samples)
    sample_time_array = np.asarray(sample_times)
    cells = np.clip(np.rint(sample_array).astype(int), 0, [line.width - 1, line.height - 1])
    nearest_ink = ndimage.distance_transform_edt(labels == 0, return_distances=False, return_indices=True)
    sample_labels = labels[nearest_ink[0][cells[:, 1], cells[:, 0]], nearest_ink[1][cells[:, 1], cells[:, 0]]]
    for label, box in enumerate(ndimage.find_objects(labels), 1):
        if box is None:
            continue
        ys, xs = np.where(labels[box] == label)
        ys += box[0].start
        xs += box[1].start
        selected = sample_labels == label
        if not selected.any():
            if len(xs) > 100 * max(scale) ** 2:
                raise ValueError("线稿存在无法连续描绘的区域；请简化该区域")
            center = to_plan([xs.mean(), ys.mean()], scale)
            _, dot_times = path([center, center], 1100., 1)
            line_times[ys, xs] = dot_times[-1]
            continue
        distance, nearest = cKDTree(sample_array[selected]).query(np.c_[xs, ys])
        if distance.max() > 12 * max(scale):
            raise ValueError("线稿局部墨迹仍无法被绘制路径覆盖；请简化该区域后重试")
        line_times[ys, xs] = sample_time_array[selected][nearest]

    line_end = now

    erase_times = np.full(sketch_alpha.shape, np.inf)
    ys, xs = np.where(sketch_alpha > 0)
    for route, group, fractions in sweeps(ys, xs, scale, radius=20.):
        xy, times = path(route, 1400., 4)
        arc = np.r_[0., np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))]
        erase_times[ys[group], xs[group]] = np.interp(fractions * arc[-1], arc, times)
    erase_end = now

    groups = {}
    for region in regions:
        groups.setdefault(region[3], []).append(region)
    color_times = np.full(alpha.shape, np.inf)
    # 浅色先画，同色区域就近；小色块使用自身像素，不并入其他颜色。
    for code in sorted(groups, key=lambda value: -np.mean([r[0] for r in groups[value]])):
        pool = groups[code]
        while pool:
            index = min(range(len(pool)), key=lambda i: np.linalg.norm((np.array([pool[i][2].mean(), pool[i][1].mean()]) + .5) / scale - .5 - tip))
            _, ys, xs, _ = pool.pop(index)
            for route, group, fractions in sweeps(ys, xs, scale):
                xy, times = path(route, 950., 2)
                arc = np.r_[0., np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))]
                color_times[ys[group], xs[group]] = np.interp(fractions * arc[-1], arc, times)
    duration = math.ceil(now)
    # 只补色层延伸到墨线下的时间；显示色区本身全部由上述真实笔刷覆盖。
    missing = (color_rgba[..., 3] > 0) & ~np.isfinite(color_times)
    if missing.any():
        valid = np.isfinite(color_times)
        if not valid.any():
            raise ValueError("绘制路径无法覆盖上色素材")
        indices = ndimage.distance_transform_edt(~valid, return_distances=False, return_indices=True)
        color_times[missing] = color_times[indices[0][missing], indices[1][missing]]
    sketch_rgba = np.zeros_like(line_rgba)
    sketch_rgba[..., :3] = [105, 145, 196]
    sketch_rgba[..., 3] = sketch_alpha
    for name, layer in [("line.png", line_rgba), ("color.png", color_rgba), ("sketch.png", sketch_rgba)]:
        Image.fromarray(layer).save(out / name)
    for name, values in [("line-time.png", line_times), ("color-time.png", color_times), ("sketch-time.png", sketch_times), ("erase-time.png", erase_times)]:
        time_png(values, out / name, line.size)
    complete = Image.new("RGBA", line.size, "white")
    complete.alpha_composite(Image.fromarray(color_rgba))
    complete.alpha_composite(Image.fromarray(line_rgba))
    complete.convert("RGB").save(out / "complete.png")
    stages = {"sketchEndMs": round(sketch_end, 3), "lineEndMs": round(line_end, 3), "eraseEndMs": round(erase_end, 3), "colorEndMs": round(now, 3)}
    render_points = to_render(np.asarray(points)[:, 1:3], scale)
    motion = {"algorithmVersion": VERSION, "cacheKey": cache_key, "width": line.width, "height": line.height, "minimumDrawMs": duration, "stageTimings": stages,
              "points": [[t, round(float(xy[0]), 3), round(float(xy[1]), 3), phase] for (t, _, _, phase), xy in zip(points, render_points)]}
    (out / "motion.json").write_text(json.dumps(motion, separators=(",", ":")))
    report = {"algorithmVersion": VERSION, "cacheKey": cache_key, "width": line.width, "height": line.height, "minimumDrawMs": duration, "stageTimings": stages,
              "lineEndMs": math.ceil(line_end), "registration": measures, "statistics": {**stats, "paint_regions": len(regions), "construction_shapes": len(shapes), "objects": int(objects.max())}}
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("lineart"); parser.add_argument("color"); parser.add_argument("output"); parser.add_argument("cache_key")
    args = parser.parse_args()
    try:
        run(args.lineart, args.color, args.output, args.cache_key)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
