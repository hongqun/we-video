"""从 sweety-handdraw-video 裁剪的配准与线条匹配算法；版权及 MIT 许可见 LICENSE。"""
import numpy as np
from scipy import ndimage
from stroke_paths import thin_ink

PLATE_INK = 128      # luminance: a line plate's ink
LINE = 110           # luminance: a line in the coloured plate (dark and nearly neutral)
NEUTRAL = 70         # RGB spread below which a dark pixel is ink, not a dark colour
NEAR = 3             # px: a plate line counts as kept when the colour plate has a line this close
FAR = 6              # px: colour-plate line work farther than this from every plate line is new
MIN_KEPT = .97       # share of the plate's lines the colour edit must keep
MAX_ADDED = .05      # new thin line work, as a share of the plate's line length
MAX_SHIFT = .02      # of the long side: a larger offset means the edit redrew the composition
CONTRAST = 20        # luminance: a drawn line is this much darker than the paint around it (grain in a dark fill is not)
COLOUR_FIX = ('Colour this exact line drawing (image 1). Keep every black line exactly where it is, with the same thickness: '
              'do not add, remove, move or redraw any line, and do not change the composition or proportions.')


def luminance(rgb):
    return rgb[..., :3].astype(float) @ [.299, .587, .114]


def best_shift(fixed, moving, reach):
    """Integer (dy, dx) moving `moving` onto `fixed` with the most line overlap: coarse on widened lines (a 2 px step
    cannot miss them), then exact on the lines themselves. A colour edit barely moves anything, so among shifts that
    overlap within 1% as well, the smallest wins: a row of identical windows otherwise matches one window over."""
    score = lambda target, dy, dx: int(np.logical_and(target, np.roll(moving, (dy, dx), (0, 1))).sum())
    wide = ndimage.binary_dilation(fixed, iterations=2)
    step = 2 if reach > 4 else 1
    nearest = lambda scored: min((item for item in scored if item[0] >= .99 * max(value for value, _ in scored)), key=lambda item: abs(item[1][0]) + abs(item[1][1]))[1]
    best = nearest([(score(wide, dy, dx), (dy, dx)) for dy in range(-reach, reach + 1, step) for dx in range(-reach, reach + 1, step)])
    return nearest([(score(fixed, dy, dx), (dy, dx)) for dy in range(best[0] - 2, best[0] + 3) for dx in range(best[1] - 2, best[1] + 3)])


def move(image, dy, dx):
    """Shift an image by whole pixels, repeating its edge into the uncovered band (paper stays paper)."""
    pad = ((max(dy, 0), max(-dy, 0)), (max(dx, 0), max(-dx, 0))) + ((0, 0),) * (image.ndim - 2)
    padded = np.pad(image, pad, mode='edge')
    top, left = max(-dy, 0), max(-dx, 0)
    return padded[top:top + image.shape[0], left:left + image.shape[1]]


def register(plate_rgb, colour_rgba):
    """(moved colour RGBA, measures) of a colour plate on its line plate (both the same size)."""
    plate = (luminance(plate_rgb) < PLATE_INK)
    rgb, alpha = colour_rgba[..., :3], colour_rgba[..., 3]
    dark = (luminance(rgb) < LINE) & (np.ptp(rgb.astype(int), axis=2) < NEUTRAL) & (alpha > 128)
    reach = max(4, round(MAX_SHIFT * max(plate.shape) * 1.5))
    # Register on edges only: the inside of a dark fill (a graphite window body, black hair) would pull every plate line
    # into itself and win at any shift that lands the lines inside it.
    # A colour edit may invert a line inside a dark fill (light code lines on a graphite terminal): that line is a line.
    inverse = inverse_lines(colour_rgba)
    edge = dark & (ndimage.distance_transform_edt(dark) <= 4) & ~ndimage.binary_dilation(inverse, iterations=4)
    dy, dx = best_shift(plate, edge | inverse, reach)
    moved = move(colour_rgba, dy, dx)
    return moved, plate, {'shift_px': [int(dy), int(dx)], **line_measures(plate, moved)}


def line_measures(plate, moved):
    """Kept plate lines, new line work and dark fills of a registered colour plate."""
    rgb, alpha = moved[..., :3].astype(int), moved[..., 3] > 128
    dark = (luminance(moved) < LINE) & (np.ptp(rgb, axis=2) < NEUTRAL) & alpha
    inverse = inverse_lines(moved)
    # ... and so is a line the edit drew in a colour or a lighter grey (a blue checklist rule, an amber heartbeat, grey list
    # lines), or the edge of a coloured area: any mark at the line. A lost line leaves bare paper, or one undivided fill.
    edge = lambda mask: mask & (ndimage.distance_transform_edt(mask) <= 5)   # a line, or the rim of an area, of that kind
    tinted = (np.ptp(rgb, axis=2) >= NEUTRAL) & alpha
    grey = (luminance(moved) < 205) & ~tinted & ~dark & alpha
    to_colour = ndimage.distance_transform_edt(~(dark | inverse | edge(tinted) | edge(grey)))
    to_plate = ndimage.distance_transform_edt(~plate)
    # New line work: thin dark marks (a fill as dark as ink, such as black hair, survives an opening; a line does not)
    # farther than FAR from every plate line.
    thin = dark & ~ndimage.binary_opening(dark, iterations=4)
    # ... and darker than the paint around it: a navy sky painted at the edge of NEUTRAL flickers between ink and
    # colour pixel by pixel, and that grain is not a line.
    lum = np.where(alpha, luminance(moved), 255.)
    darker = ndimage.uniform_filter(lum, 15) - lum >= CONTRAST
    added = thin_ink(thin & darker & (to_plate > FAR))
    plate_length = max(1, int(thin_ink(plate).sum()))
    return {'inverse_line_px': int(inverse.sum()), 'kept_lines': round(float((to_colour[plate] <= NEAR).mean()), 4) if plate.any() else 0.,
            'added_line_share': round(int(added.sum()) / plate_length, 4), 'plate_line_px': plate_length,
            'dark_fill_share': round(float((dark & (to_plate > FAR)).sum()) / max(1, int(plate.sum())), 4)}


def inverse_lines(rgba):
    """Thin light lines lying inside dark fills (light code lines on a graphite window): lines the edit drew inverted."""
    lum, alpha = luminance(rgba), rgba[..., 3] > 128
    dark = (lum < LINE) & alpha
    light = (lum > 150) & alpha
    broad = ndimage.binary_opening(light, iterations=7)   # light areas wider than a drawn line (~14 px): paper, screens
    inside = ndimage.binary_closing(dark, iterations=8)
    return light & ~broad & inside


