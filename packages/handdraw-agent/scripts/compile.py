#!/usr/bin/env python3
"""将语义部位编译为透明图层、毫秒时间图和笔尖轨迹，不制作视频。"""
import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(Path(__file__).parent), str(ROOT / "scripts/handdraw"), str(ROOT / "scripts/handdraw/vendor")]
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree
from line_first import register, move, luminance, MIN_KEPT, MAX_ADDED, MAX_SHIFT
from line_topology import extract_strokes, cover_ink_edges
from choreography import densify, path_times, sweeps
from prepare import clean_line_gray, color_layer, load_white, time_png
from handwriting import build_label, FONT, BUNDLE


def line_data(file):
    image = load_white(file)
    image.thumbnail((960, 960), Image.Resampling.LANCZOS)
    gray = clean_line_gray(luminance(np.asarray(image)))
    ink = gray < 150
    if ink.sum() < 30 or ink.mean() > .25:
        raise ValueError("线稿为空或大片涂黑，请减少填充，保留连续清晰的轮廓")
    if np.mean(np.ptp(np.asarray(image).astype(int), axis=2) > 35) > .01:
        raise ValueError("线稿含彩色区域，请使用白底纯黑线稿")
    return image, gray, ink


def routes_for(ink):
    strokes, _, _, _ = extract_strokes(ink)
    cover_ink_edges(strokes, ink, maximum=6.)
    if not strokes or len(strokes) > 1000 or sum(len(item['points']) for item in strokes) > 300000:
        raise ValueError("线稿笔画过多或无法提取，请去掉纹理、阴影及细碎线条")
    # 同一部位先外轮廓，再按空间邻近描细节，不依文件扫描顺序来回跳笔。
    return sorted(strokes, key=lambda item: -float(np.linalg.norm(np.diff(item['points'], axis=0), axis=1).sum()))


def measure(file):
    _, _, ink = line_data(file)
    strokes = routes_for(ink)
    cost = sum(max(80., np.linalg.norm(np.diff(item['points'], axis=0), axis=1).sum() / 900 * 1000) + 70 for item in strokes)
    return {'strokeCount': len(strokes), 'minimumLineMs': math.ceil(cost), 'message': '仅为描线下限，上色、手写和阅读时间需在完整编译时另计'}


def ownership(shape, parts, foreground):
    height, width = shape
    ys, xs = np.indices(shape)
    result = np.full(shape, -1, np.int16)
    distances = []
    # 框重叠时较小的语义部位优先，头部不会被后面的全身大框吞掉。
    for index in sorted(range(len(parts)), key=lambda i: parts[i]['box'][2] * parts[i]['box'][3]):
        x, y, w, h = parts[index]['box']
        dx = np.maximum(np.maximum(x - xs / width, xs / width - x - w), 0)
        dy = np.maximum(np.maximum(y - ys / height, ys / height - y - h), 0)
        inside = (dx == 0) & (dy == 0)
        result[(result < 0) & inside] = index
    for part in parts:
        x, y, w, h = part['box']
        dx = np.maximum(np.maximum(x - xs / width, xs / width - x - w), 0)
        dy = np.maximum(np.maximum(y - ys / height, ys / height - y - h), 0)
        distances.append(np.hypot(dx, dy))
    distances = np.stack(distances)
    missing = foreground & (result < 0)
    if np.any(missing & (distances.min(axis=0) > .08)):
        raise ValueError("部位框遗漏较远的真实画面内容，请根据视觉复核修正部位范围")
    result[missing] = distances.argmin(axis=0)[missing]
    return result


def fit_box(box, width, height):
    x, y, w, h = box
    scale = min(w * 960 / width, h * 800 / height)
    fw, fh = width * scale / 960, height * scale / 800
    return [x + (w-fw)/2, y + (h-fh)/2, fw, fh]


def write_layer(out, action_id, kind, box, line, color, line_times, color_times, points, duration):
    directory = out / action_id
    directory.mkdir(parents=True, exist_ok=True)
    height, width = line.shape[:2]
    Image.fromarray(line).save(directory / 'line.png')
    Image.fromarray(color).save(directory / 'color.png')
    time_png(line_times, directory / 'line-time.png', (width, height))
    time_png(color_times, directory / 'color-time.png', (width, height))
    if len(points) < 2:
        raise ValueError(f'动作 {action_id} 缺少可描绘的路径')
    duration = math.ceil(duration)
    (directory / 'motion.json').write_text(json.dumps({'durationMs': duration, 'points': points}, allow_nan=False))
    return {'id': action_id, 'kind': kind, 'box': box, 'width': width, 'height': height, 'durationMs': duration,
            'linePath': f'{action_id}/line.png', 'colorPath': f'{action_id}/color.png',
            'lineTimePath': f'{action_id}/line-time.png', 'colorTimePath': f'{action_id}/color-time.png', 'motionPath': f'{action_id}/motion.json'}


def compile_picture(spec, art, out):
    image, gray, ink = line_data(art['lineFile'])
    original_color = load_white(art['colorFile'])
    if abs(original_color.width / original_color.height - image.width / image.height) > .01:
        raise ValueError('上色图改变了线稿比例，请以上传线稿为输入重新上色')
    original_color = original_color.resize(image.size, Image.Resampling.LANCZOS)
    _, _, report = register(np.asarray(image), np.asarray(original_color.convert('RGBA')))
    dy, dx = report['shift_px']
    if report['kept_lines'] < MIN_KEPT or report['added_line_share'] > MAX_ADDED or max(abs(dx), abs(dy)) > MAX_SHIFT * max(image.size):
        raise ValueError(f"上色图重画了线条：保留 {report['kept_lines']:.1%}，新增 {report['added_line_share']:.1%}；请只编辑颜色")
    aligned = move(np.asarray(original_color), dy, dx)
    colors = color_layer(aligned, gray, edge_margin=2)
    # 封闭轮廓里的白色属于物体，画外白纸保持透明以融入项目主题。
    enclosed = ndimage.binary_fill_holes(gray < 245) & ~(gray < 245)
    colors[enclosed & (colors[..., 3] == 0)] = [255, 255, 255, 255]
    foreground = (gray < 245) | (colors[..., 3] > 0)
    owners = ownership(gray.shape, spec['parts'], foreground)
    image_box = fit_box(spec['box'], image.width, image.height)
    layers = []
    for index, part in enumerate(spec['parts']):
        owned = owners == index
        content = foreground & owned
        ys, xs = np.where(content)
        if not len(xs):
            raise ValueError(f"部位 {part['name']} 没有可绘制内容，请合并或修正区域")
        left, top, right, bottom = int(xs.min()), int(ys.min()), int(xs.max())+1, int(ys.max())+1
        selected = np.s_[top:bottom, left:right]
        local_gray = gray[selected]
        local_owned = owned[selected]
        local_ink = (local_gray < 150) & local_owned
        line = np.zeros((*local_gray.shape, 4), np.uint8)
        line[..., 3] = np.where(local_owned, 255 - local_gray, 0).astype(np.uint8)
        color = colors[selected].copy()
        color[~local_owned, 3] = 0
        line_times = np.full(local_gray.shape, np.inf)
        color_times = np.full(local_gray.shape, np.inf)
        points, now, tip = [], 0., np.zeros(2)

        def draw(route, speed, phase):
            nonlocal now, tip
            route = densify(route)
            travel = max(50., np.linalg.norm(route[0] - tip) / 3.)
            points.extend([[round(now, 3), *tip.tolist(), 0], [round(now + travel, 3), *route[0].tolist(), 0]])
            now += travel
            times = path_times(route, speed, now)
            # 每笔至少占两帧，短笔不会在导出时整笔跳过。
            duration = max(70., times[-1] - times[0])
            times = now + (times - times[0]) / max(.001, times[-1] - times[0]) * duration if times[-1] > times[0] else np.linspace(now, now + duration, len(route))
            points.extend([[round(float(t), 3), float(p[0]), float(p[1]), phase] for t, p in zip(times, route)])
            now = float(times[-1]) + 20.
            tip = route[-1]
            points.append([round(now, 3), *tip.tolist(), 0])
            return route, times

        samples, sample_times = [], []
        if local_ink.any():
            for stroke in routes_for(local_ink):
                route, times = draw(stroke['points'], 900., 1)
                samples.extend(route.tolist()); sample_times.extend(times.tolist())
            py, px = np.where(line[..., 3] > 0)
            _, nearest = cKDTree(np.asarray(samples)).query(np.c_[px, py])
            line_times[py, px] = np.asarray(sample_times)[nearest]
        elif line[..., 3].any():
            raise ValueError(f"部位 {part['name']} 只有灰色噪点，无法描线")
        # 同色连通区域逐区涂色；不借助整块显现掩盖绘制路径。
        regions, count = ndimage.label(color[..., 3] > 0)
        for region in range(1, count + 1):
            py, px = np.where(regions == region)
            for route, group, fractions in sweeps(py, px, np.ones(2), radius=14.):
                route, times = draw(route, 1500., 2)
                arc = np.r_[0., np.cumsum(np.linalg.norm(np.diff(route, axis=0), axis=1))]
                color_times[py[group], px[group]] = np.interp(fractions * arc[-1], arc, times)
        if np.any((line[..., 3] > 0) & ~np.isfinite(line_times)) or np.any((color[..., 3] > 0) & ~np.isfinite(color_times)):
            raise ValueError('部位包含没有绘制路径的像素')
        box = [image_box[0] + image_box[2] * left/image.width, image_box[1] + image_box[3] * top/image.height,
               image_box[2] * (right-left)/image.width, image_box[3] * (bottom-top)/image.height]
        layers.append(write_layer(out, spec['id'] + '-' + part['id'], 'illustration', box, line, color, line_times, color_times, points, now))
    return layers


def compile_job(file, out):
    value = json.loads(file.read_text())
    out.mkdir(parents=True, exist_ok=True)
    layers = []
    for picture in value['design']['illustrations']:
        layers.extend(compile_picture(picture, value['artworks'][picture['artworkId']], out))
    notes = []
    for label in value['design']['labels']:
        w, h = max(1, round(label['box'][2]*960)), max(1, round(label['box'][3]*800))
        local = {**label, 'box': [0, 0, 1, 1], 'fontSize': label['fontSize']/w}
        line, times, points, report = build_label(local, w, h)
        rgb = tuple(int(label['color'][i:i+2], 16) for i in (1, 3, 5))
        line[..., :3] = rgb
        layers.append(write_layer(out, label['id'], 'text', label['box'], line, np.zeros_like(line), times, np.full((h,w), np.inf), points, report['requiredMs']))
        notes.append(report)
    (out/'report.json').write_text(json.dumps({'layers': layers, 'notes': notes}, ensure_ascii=False, allow_nan=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['doctor', 'probe', 'compile'])
    parser.add_argument('source', type=Path, nargs='?')
    parser.add_argument('output', type=Path, nargs='?')
    args = parser.parse_args()
    try:
        if args.command == 'doctor':
            if not FONT.is_file() or not BUNDLE.is_file(): raise ValueError('缺少本地手写字体或笔顺资料，请完整部署手绘 Agent 资源')
            print(json.dumps({'ready': True}))
        elif args.command == 'probe':
            if args.source is None: raise ValueError('probe 需要线稿文件')
            print(json.dumps(measure(args.source)))
        else:
            if args.source is None or args.output is None: raise ValueError('compile 需要输入文件和输出目录')
            compile_job(args.source, args.output)
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
