"""独立文字编译：汉字按本地笔顺资料，其他字形沿字体骨架逐笔描写。

方法参考 sweety-handdraw-video；字形数据的来源与许可见 assets/hanzi/。
本模块不下载字形、不调用外部仓库，像素和笔尖共用同一弧长时间。
"""
import json
import lzma
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.spatial import cKDTree

from choreography import densify, path_times
from line_topology import extract_strokes, cover_ink_edges

ROOT = Path(__file__).resolve().parents[3]
FONT = ROOT / "public/fonts/ZCOOLKuaiLe-Regular.ttf"
BUNDLE = Path(__file__).resolve().parents[1] / "resources/hanzi/gb2312-strokes.json.xz"


@lru_cache(maxsize=1)
def glyph_data():
    return json.loads(lzma.decompress(BUNDLE.read_bytes()))["characters"]


def chinese(char):
    return '\u3400' <= char <= '\u9fff' or '\uf900' <= char <= '\ufaff' or '\U00020000' <= char <= '\U0003134f'


def polygon_path(value):
    """展开资料内的 SVG 曲线，不依赖浏览器或系统字体路径解析器。"""
    tokens = re.findall(r"[MLQCZmlqcz]|-?\d+(?:\.\d+)?", value)
    result, current, command, index = [], np.zeros(2), 'M', 0
    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
            if command.lower() == 'z':
                continue
        count = {'m': 2, 'l': 2, 'q': 4, 'c': 6}[command.lower()]
        points = np.asarray(tokens[index:index + count], float).reshape(-1, 2)
        index += count
        if command.islower():
            points += current
        if len(points) == 1:
            result.append(points[0])
        else:
            t = np.linspace(0, 1, 13)[1:, None]
            curve = ((1-t)**2*current + 2*(1-t)*t*points[0] + t*t*points[1]) if len(points) == 2 else ((1-t)**3*current + 3*(1-t)**2*t*points[0] + 3*(1-t)*t*t*points[1] + t**3*points[2])
            result.extend(curve)
        current = points[-1]
        if command.lower() == 'm':
            command = 'l' if command.islower() else 'L'
    return np.asarray(result)


def font_paths(char, font, size):
    # 项目字体缺少部分关系符号时，使用确定性的示意线；不以缺字方框冒充符号。
    if char in ('→', '≈'):
        width = max(12, round(font.getlength(char)))
        patch = Image.new('L', (width + 4, size + 4))
        if char == '→':
            routes = [np.array([[2, size * .48], [width, size * .48]]), np.array([[width * .65, size * .25], [width, size * .48], [width * .65, size * .71]])]
        else:
            xs = np.linspace(2, width, 40)
            routes = [np.c_[xs, base * size + np.sin(np.linspace(0, 2 * np.pi, 40)) * size * .045] for base in (.36, .61)]
        for route in routes:
            ImageDraw.Draw(patch).line([tuple(p) for p in route], fill=255, width=max(2, round(size * .055)))
        return np.asarray(patch), routes
    box = font.getbbox(char)
    patch = Image.new('L', (max(1, box[2] - box[0] + 4), max(1, box[3] - box[1] + 4)))
    ImageDraw.Draw(patch).text((2 - box[0], 2 - box[1]), char, font=font, fill=255)
    alpha = np.asarray(patch)
    if not char.isspace() and (not alpha.any() or (font.getmask(char).size == font.getmask('\U0010ffff').size and bytes(font.getmask(char)) == bytes(font.getmask('\U0010ffff')))):
        raise ValueError(f'字体缺少字符 {char!r}，请修改标签或安装包含该字符的字体')
    paths, _, _, _ = extract_strokes(alpha > 80)
    cover_ink_edges(paths, alpha > 0, maximum=5.)
    routes = []
    for item in paths:
        xy = item['points']
        delta = xy[-1] - xy[0]
        if delta[0] < 0 if abs(delta[0]) > abs(delta[1]) else delta[1] < 0:
            xy = xy[::-1]
        routes.append(xy)
    return alpha, routes


def build_label(label, width, height):
    """返回文字层、毫秒时间图、独立笔画及可读的回退记录。"""
    x, y, w, h = [int(round(v * scale)) for v, scale in zip(label['box'], [width, height, width, height])]
    size = max(12, round(label['fontSize'] * width))
    font = ImageFont.truetype(str(FONT), size)
    text = label['text']
    data = glyph_data()
    missing = [char for char in text if chinese(char) and char not in data]
    fallback = bool(missing)
    canvas = np.zeros((height, width, 4), np.uint8)
    reveal = np.full((height, width), np.inf)
    points, now, tip = [], 0., None
    cursor_y = y
    for row in text.split('\n'):
        cursor_x = x
        for char in row:
            advance = float(font.getlength(char))
            if char.isspace():
                cursor_x += advance
                continue
            # 字形始终来自站酷快乐体；笔顺资料只辅助路径排序，不能覆盖实际手写轮廓。
            patch, routes = font_paths(char, font, size)
            if chinese(char) and char in data and routes:
                outlines, medians = data[char]
                cloud = np.vstack([polygon_path(value) for value in outlines])
                low, high = cloud.min(axis=0), cloud.max(axis=0)
                py0, px0 = np.where(patch > 0)
                left, top = float(px0.min()), float(py0.min())
                gw, gh = max(1., float(px0.max()-px0.min())), max(1., float(py0.max()-py0.min()))
                guides = [np.c_[left + (np.asarray(m)[:, 0]-low[0])/max(1., high[0]-low[0])*gw,
                                top + (high[1]-np.asarray(m)[:, 1])/max(1., high[1]-low[1])*gh] for m in medians]
                trees = [cKDTree(guide) for guide in guides]
                routes = sorted(routes, key=lambda route: int(np.argmin([tree.query(route)[0].mean() for tree in trees])))
            alpha = np.zeros((height, width), np.uint8)
            px, py = round(cursor_x), cursor_y
            ph, pw = patch.shape
            if px + pw > x + w or py + ph > y + h:
                raise ValueError(f'文字“{text}”超出文字框，请增大框、换行或减小字号')
            alpha[py:py + ph, px:px + pw] = patch
            entries = [(alpha, densify(route + [px, py])) for route in routes]
            if cursor_x + advance > x + w + .5 or cursor_y + size > y + h + .5:
                raise ValueError(f'文字“{text}”超出文字框，请增大框、换行或减小字号')
            if entries:
                routes = [route for _, route in entries]
                if routes:
                    samples = np.vstack(routes)
                    ends = np.cumsum([len(route) for route in routes])
                    ys, xs = np.where(entries[0][0] > 0)
                    _, nearest = cKDTree(samples).query(np.c_[xs, ys])
                    owners = np.searchsorted(ends, nearest, side='right')
                    new_entries = []
                    for index, (_, route) in enumerate(entries):
                        owned = np.zeros((height, width), np.uint8)
                        owned[ys[owners == index], xs[owners == index]] = entries[0][0][ys[owners == index], xs[owners == index]]
                        new_entries.append((owned, route))
                    entries = new_entries
            for alpha, route in entries:
                if tip is not None:
                    travel = max(18., np.linalg.norm(route[0] - tip) / max(1., size) * 22)
                    points.extend([[now, *tip, 0], [now + travel, *route[0], 0]])
                    now += travel
                times = path_times(route, max(20., size * 16), now)
                # 快速书写保留短暂落笔，文字与插画分别编排，不能沿用慢速描画节奏。
                span = max(70., times[-1] - times[0])
                if times[-1] > times[0]:
                    times = now + (times - times[0]) * span / (times[-1] - times[0])
                else:
                    times = np.linspace(now, now + span, len(route))
                ys, xs = np.where(alpha > 0)
                if len(xs):
                    _, nearest = cKDTree(route).query(np.c_[xs, ys])
                    selected = (canvas[ys, xs, 3] == 0) | (alpha[ys, xs] >= canvas[ys, xs, 3])
                    reveal[ys[selected], xs[selected]] = times[nearest[selected]]
                    canvas[..., 3] = np.maximum(canvas[..., 3], alpha)
                points.extend([[float(t), float(p[0]), float(p[1]), 5] for t, p in zip(times, route)])
                now = float(times[-1]) + 10.
                tip = route[-1]
                points.append([now, *tip, 0])
            cursor_x += advance
        cursor_y += round(size * 1.35)
    if np.any((canvas[..., 3] > 0) & ~np.isfinite(reveal)):
        raise ValueError(f'文字“{text}”存在无法描绘的笔画')
    report = {'id': label['id'], 'text': text, 'mode': 'handwritten_font', 'font': 'ZCOOL KuaiLe', 'reason': f'字符 {"".join(missing)} 缺少笔顺引导，按字体路径书写' if fallback else '字形使用站酷快乐体，笔顺资料仅辅助路径排序', 'requiredMs': now}
    return canvas, reveal, points, report
