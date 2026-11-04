#!/usr/bin/env python3
"""把线稿和彩图编译成不可变图层、显现时间图和画笔路径；不执行视频渲染。"""
import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "vendor"))
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from line_first import register, move, luminance, MIN_KEPT, MAX_ADDED, MAX_SHIFT
from line_topology import extract_strokes

VERSION = "handdraw-4"


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
        raise ValueError("线稿为空或包含大片填充；请生成纯白底、无填充的简洁黑色线稿")
    if np.mean(np.ptp(rgb.astype(int), axis=2) > 35) > .01:
        raise ValueError("线稿含有彩色区域；请上传纯黑白线稿")
    moved, _, measures = register(rgb, np.array(color.resize(plan.size).convert("RGBA")))
    dy, dx = measures["shift_px"]
    if measures["kept_lines"] < MIN_KEPT or measures["added_line_share"] > MAX_ADDED or max(abs(dx), abs(dy)) > MAX_SHIFT * max(w, h):
        raise ValueError(f"上色图与线稿不匹配（保留线条 {measures['kept_lines']:.1%}，新增线条 {measures['added_line_share']:.1%}）；请附上原线稿，只上色，不移动或重画线条")
    strokes, _, _, stats = extract_strokes(ink)
    if not strokes or len(strokes) > 1500:
        raise ValueError("线稿无法提取或笔画过多；请减少纹理和细节后重新上传")
    out = Path(output)
    out.mkdir(parents=True, exist_ok=True)
    now, points, samples, sample_times = 50., [], [], []
    tip = np.array([0., 0.])

    def path(points_xy, speed, phase):
        nonlocal now, tip
        points_xy = np.asarray(points_xy, float)
        gap = max(60., np.linalg.norm(points_xy[0] - tip) / 2.)
        points.append([round(now, 3), float(tip[0]), float(tip[1]), 0])
        now += gap
        points.append([round(now, 3), float(points_xy[0, 0]), float(points_xy[0, 1]), phase])
        times = [now]
        for a, b in zip(points_xy[:-1], points_xy[1:]):
            now += max(.5, float(np.linalg.norm(b - a)) / speed * 1000.)
            times.append(now)
            points.append([round(now, 3), float(b[0]), float(b[1]), phase])
        tip = points_xy[-1]
        now += 35.
        points.append([round(now, 3), float(tip[0]), float(tip[1]), 0])
        if now > 600000 or len(points) > 500000:
            raise ValueError("整图绘制过于复杂；请减少对象、线条和色块")
        return np.asarray(times)

    # 长轮廓优先，阶段内就近接续；只移动笔，不把不连通的线硬接起来。
    pool = sorted(strokes, key=lambda s: -s["length"])
    while pool:
        candidates = pool[:min(16, len(pool))]
        index = min(range(len(candidates)), key=lambda i: min(np.linalg.norm(candidates[i]["points"][0] - tip), np.linalg.norm(candidates[i]["points"][-1] - tip)))
        stroke = pool.pop(index)
        xy = stroke["points"]
        if np.linalg.norm(xy[-1] - tip) < np.linalg.norm(xy[0] - tip):
            xy = xy[::-1]
        times = path(xy, 1100., 1)
        samples.extend(xy.tolist())
        sample_times.extend(times.tolist())
    # 每个墨迹连通域独立寻找笔尖经过时间，孤立小点也安排真实落笔。
    labels, count = ndimage.label(gray < 245, structure=np.ones((3, 3)))
    line_times = np.full((h, w), np.inf)
    sample_array = np.asarray(samples)
    sample_time_array = np.asarray(sample_times)
    cells = np.clip(np.rint(sample_array).astype(int), 0, [w - 1, h - 1])
    sample_labels = labels[cells[:, 1], cells[:, 0]]
    for label, box in enumerate(ndimage.find_objects(labels), 1):
        if box is None:
            continue
        ys, xs = np.where(labels[box] == label)
        ys += box[0].start; xs += box[1].start
        if not len(xs):
            continue
        component_points = np.c_[xs, ys]
        selected = sample_labels == label
        if selected.any():
            distance, nearest = cKDTree(sample_array[selected]).query(component_points)
            if distance.max() > 12:
                raise ValueError("线稿有过粗的黑色区域；请去掉填充，保留轮廓线")
            line_times[ys, xs] = sample_time_array[selected][nearest]
        else:
            # 极小连通域用一次点按覆盖，仍参与时长预算。
            if len(xs) > 100:
                raise ValueError("线稿存在无法连续描绘的区域；请简化该区域")
            center = [float(xs.mean()), float(ys.mean())]
            time = path([center, center], 1100., 1)[-1]
            line_times[ys, xs] = time
    line_end = now
    paint = moved[..., :3]
    # 按真实色块分区，线稿附近视作边界；色块内保留原始像素颜色。
    fill_mask, regions = paint_regions(paint, gray)
    groups = {}
    for region in regions:
        groups.setdefault(region[3], []).append(region)

    def marker_order():
        # 一支颜色涂完再换笔，同色的区域按笔尖距离就近处理。
        for code in sorted(groups, key=lambda value: -np.mean([r[0] for r in groups[value]])):
            pool = groups[code]
            while pool:
                index = min(range(min(32, len(pool))), key=lambda i: (pool[i][2].mean() - tip[0]) ** 2 + (pool[i][1].mean() - tip[1]) ** 2)
                yield pool.pop(index)
    color_times = np.full((h, w), np.inf)
    # 马克笔按斜向行往复扫过，每条路径仅显现所属色块的像素，避免越界。
    radius = 7.
    for _, ys, xs, _ in marker_order():
        bands = np.floor((ys + xs * .35) / (radius * 1.6)).astype(int)
        reverse = False
        for band in np.unique(bands):
            pick = bands == band
            bx, by = xs[pick], ys[pick]
            order = np.argsort(bx)
            if reverse:
                order = order[::-1]
            reverse = not reverse
            # 行内长空白处抬笔，不能跨越无关物体时继续出墨。
            breaks = np.r_[0, np.where(np.abs(np.diff(bx[order])) > 3)[0] + 1, len(order)]
            for start, end in zip(breaks[:-1], breaks[1:]):
                group = order[start:end]
                coords = np.c_[bx[group], by[group]]
                # 中心轨迹沿横向笔道，像素按笔头半径首次接触时显现。
                a, b = coords[0].astype(float), coords[-1].astype(float)
                band_center = np.median(by[group] + bx[group] * .35)
                a[1] = band_center - a[0] * .35
                b[1] = band_center - b[0] * .35
                length = np.linalg.norm(b - a)
                route = np.linspace(a, b, max(2, int(length / 2) + 1))
                times = path(route, 950., 2)
                distance = np.abs(coords[:, 0] - a[0])
                fractions = np.clip((distance - radius) / max(1., abs(b[0] - a[0])), 0, 1)
                color_times[by[group], bx[group]] = times[0] + fractions * (times[-1] - times[0])
    if now > 600000 or len(points) > 500000:
        raise ValueError("整图绘制过于复杂；请减少对象、线条和色块")
    duration = math.ceil(now)
    # 墨线与底色在原始分辨率独立清理，低分辨率规划场只负责时间，不裁切显示边缘。
    full_gray = clean_line_gray(np.array(line.convert("L")))
    aligned = move(np.array(color), round(dy * line.height / h), round(dx * line.width / w))
    alpha = 255 - full_gray
    line_rgba = np.zeros((line.height, line.width, 4), np.uint8)
    line_rgba[..., 3] = alpha
    color_rgba = color_layer(aligned, full_gray, edge_margin=2 * max(line.width / w, line.height / h))
    if not fill_mask.any():
        color_rgba[..., 3] = 0
    Image.fromarray(line_rgba).save(out / "line.png")
    Image.fromarray(color_rgba).save(out / "color.png")
    time_png(line_times, out / "line-time.png", line.size)
    time_png(color_times, out / "color-time.png", line.size)
    # 高分辨率边缘的时间取规划场最近有效点，避免细线在最后一帧才补现。
    for name, mask in [("line-time.png", alpha > 0), ("color-time.png", color_rgba[..., 3] > 0)]:
        image = np.array(Image.open(out / name))
        valid = image[..., 3] > 0
        missing = mask & ~valid
        if missing.any():
            if not valid.any():
                raise ValueError("绘制路径无法覆盖素材；请检查线稿或上色图")
            indices = ndimage.distance_transform_edt(~valid, return_distances=False, return_indices=True)
            image[missing] = image[indices[0][missing], indices[1][missing]]
        image[..., 3][~mask] = 0
        Image.fromarray(image).save(out / name)
    complete = Image.new("RGBA", line.size, "white")
    complete.alpha_composite(Image.fromarray(color_rgba))
    complete.alpha_composite(Image.fromarray(line_rgba))
    complete.convert("RGB").save(out / "complete.png")
    motion = {"algorithmVersion": VERSION, "cacheKey": cache_key, "width": line.width, "height": line.height, "minimumDrawMs": duration,
              "points": [[t, round(x / w * line.width, 3), round(y / h * line.height, 3), phase] for t, x, y, phase in points]}
    (out / "motion.json").write_text(json.dumps(motion, separators=(",", ":")))
    report = {"algorithmVersion": VERSION, "cacheKey": cache_key, "width": line.width, "height": line.height, "minimumDrawMs": duration,
              "lineEndMs": math.ceil(line_end), "registration": measures, "statistics": {**stats, "paint_regions": len(regions)}}
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
