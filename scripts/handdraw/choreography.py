"""手绘编排：空间对象内描线、浅蓝起形与按形状扫笔；所有路径使用规划像素坐标。

参考 sweety-handdraw-video 的 line_drawing / paint_motion 方法独立裁剪实现；
现有拓扑代码的 MIT 来源说明保留在 vendor/LICENSE。
"""
import math
import numpy as np
from scipy import ndimage
from scipy.spatial import ConvexHull, cKDTree


def to_render(points, scale):
    # 对齐像素中心，不能直接把规划像素的左上角乘以缩放倍数。
    return (np.asarray(points, float) + .5) * np.asarray(scale) - .5


def to_plan(points, scale):
    return (np.asarray(points, float) + .5) / np.asarray(scale) - .5


def densify(points, step=1.):
    points = np.asarray(points, float)
    result = [points[0]]
    for a, b in zip(points[:-1], points[1:]):
        count = max(1, math.ceil(np.linalg.norm(b - a) / step))
        result.extend(np.linspace(a, b, count + 1)[1:])
    return np.asarray(result)


def ordered_strokes(strokes, ink):
    """填实闭合对象把内部孤立细节归到主体，先轮廓再结构，最后短细节。"""
    solid = ndimage.binary_fill_holes(ndimage.binary_closing(ink, iterations=2)) | ink
    objects, _ = ndimage.label(solid, structure=np.ones((3, 3)))
    depth = ndimage.distance_transform_edt(solid)
    groups = {}
    for index, stroke in enumerate(strokes):
        cells = np.clip(np.rint(stroke['points']).astype(int), 0, [ink.shape[1] - 1, ink.shape[0] - 1])
        owner = int(np.bincount(objects[cells[:, 1], cells[:, 0]]).argmax())
        edge = np.mean(depth[cells[:, 1], cells[:, 0]] <= 4) >= .5
        stroke = {**stroke, 'object': owner, 'tier': 0 if edge and stroke['length'] >= 20 else 1 if stroke['length'] >= 40 else 2, 'index': index}
        groups.setdefault(owner, []).append(stroke)
    ordered, tip = [], np.zeros(2)
    # 对象先按面积选主次，同一对象的笔画一次画完。
    sizes = np.bincount(objects.ravel())
    for owner in sorted(groups, key=lambda key: (-sizes[key], key)):
        pool = groups[owner]
        drawn = []
        while pool:
            tree = cKDTree(np.asarray(drawn)) if drawn else None
            def cost(stroke):
                xy = stroke['points']
                near = min(np.linalg.norm(xy[0] - tip), np.linalg.norm(xy[-1] - tip))
                attach = min(tree.query(xy[[0, -1]])[0]) if tree is not None else 0.
                return stroke['tier'] * 10000 + near + min(80., attach) * 2, stroke['index']
            index = min(range(len(pool)), key=lambda i: cost(pool[i]))
            stroke = pool.pop(index)
            xy = stroke['points']
            # 长线优先向右或向下，短线就近接续；回路固定从顶部起笔。
            if stroke.get('closed'):
                k = int(np.argmin(xy[:, 1] * ink.shape[1] + xy[:, 0]))
                xy = np.vstack([xy[k:], xy[:k + 1]])
            else:
                delta = xy[-1] - xy[0]
                backwards = delta[1] < 0 if abs(delta[1]) > .6 * abs(delta[0]) else delta[0] < 0
                if stroke['length'] < 25:
                    backwards = np.linalg.norm(xy[-1] - tip) < np.linalg.norm(xy[0] - tip)
                if backwards:
                    xy = xy[::-1]
            stroke['points'] = xy
            ordered.append(stroke)
            drawn.extend(xy[::max(1, len(xy) // 100)].tolist())
            tip = xy[-1]
    return ordered, objects


def construction(objects):
    """从主要对象的凸轮廓简化起形，不把内部纹理重画一遍。"""
    shapes = []
    sizes = np.bincount(objects.ravel())
    for owner in sorted(range(1, len(sizes)), key=lambda key: (-sizes[key], key)):
        ys, xs = np.where(objects == owner)
        if len(xs) < 12:
            continue
        cloud = np.c_[xs, ys]
        # 退化直线也保留一条起形轨迹，避免简单图标缺失阶段。
        if np.linalg.matrix_rank(cloud - cloud.mean(axis=0)) < 2:
            _, vectors = np.linalg.eigh((cloud - cloud.mean(axis=0)).T @ (cloud - cloud.mean(axis=0)))
            projected = cloud @ vectors[:, -1]
            shape = cloud[[np.argmin(projected), np.argmax(projected)]]
        else:
            hull = ConvexHull(cloud)
            shape = cloud[hull.vertices]
            if len(shape) > 24:
                shape = shape[np.linspace(0, len(shape) - 1, 24).astype(int)]
            shape = np.vstack([shape, shape[0]])
        shapes.append(densify(shape))
        if len(shapes) == 16:
            break
    return shapes


def path_times(xy, speed, start):
    """以弧长分配时间，起收笔和真实弯角减速；结果直接用于笔尖和显现图。"""
    steps = np.linalg.norm(np.diff(xy, axis=0), axis=1)
    arc = np.r_[0., np.cumsum(steps)]
    if arc[-1] < .0001:
        return np.array([start, start + 1.])
    # 使用间隔约 5 像素的切向量，过滤像素骨架本身的阶梯抖动。
    reach = min(5, max(1, (len(xy) - 1) // 2))
    before = xy - xy[np.maximum(0, np.arange(len(xy)) - reach)]
    after = xy[np.minimum(len(xy) - 1, np.arange(len(xy)) + reach)] - xy
    denom = np.linalg.norm(before, axis=1) * np.linalg.norm(after, axis=1)
    cosine = np.ones(len(xy))
    np.divide((before * after).sum(axis=1), denom, out=cosine, where=denom > 1e-6)
    bend = np.arccos(np.clip(cosine, -1, 1)) / np.pi
    end_slow = .65 * (np.exp(-arc / 8) + np.exp(-(arc[-1] - arc) / 8))
    weights = 1 + end_slow + 1.5 * bend
    return start + np.r_[0., np.cumsum(np.maximum(.5, steps / speed * 1000 * (weights[:-1] + weights[1:]) / 2))]


def sweeps(ys, xs, scale, radius=7.):
    """主轴决定方向，短道往复；每个像素只分配给本色区的一条覆盖路径。"""
    coords = to_plan(np.c_[xs, ys], scale)
    centered = coords - coords.mean(axis=0)
    covariance = centered.T @ centered
    values, vectors = np.linalg.eigh(covariance)
    direction = vectors[:, -1] if values[-1] > 1.8 ** 2 * max(1., values[0]) else np.array([1., -.6])
    if direction[0] < 0:
        direction = -direction
    direction /= np.linalg.norm(direction)
    normal = np.array([-direction[1], direction[0]])
    along, across = coords @ direction, coords @ normal
    bands = np.floor((across - across.min()) / (radius * 1.1)).astype(int)
    reverse = False
    for band in np.unique(bands):
        selected = np.where(bands == band)[0]
        order = selected[np.argsort(along[selected], kind='stable')]
        # 空白处断开，长笔道分成腕部可完成的短段。
        cuts = np.r_[0, np.where(np.diff(along[order]) > 2.5)[0] + 1, len(order)]
        chunks = []
        for left, right in zip(cuts[:-1], cuts[1:]):
            run = order[left:right]
            lanes = np.floor((along[run] - along[run].min()) / (radius * 9)).astype(int)
            chunks.extend(run[lanes == lane] for lane in np.unique(lanes))
        if reverse:
            chunks.reverse()
        for group in chunks:
            center = (across[group].min() + across[group].max()) / 2
            lo, hi = along[group].min(), along[group].max()
            a, b = direction * lo + normal * center, direction * hi + normal * center
            if reverse:
                a, b = b, a
            length = np.linalg.norm(b - a)
            route = densify([a, b])
            perpendicular = np.abs(across[group] - center)
            advance = np.abs(along[group] - (hi if reverse else lo))
            # 圆形笔头首次触及像素的距离，完全在输出像素坐标下求值。
            contact = np.clip(advance - np.sqrt(np.maximum(0., radius ** 2 - perpendicular ** 2)), 0, length)
            yield route, group, contact / max(.0001, length)
        reverse = not reverse
