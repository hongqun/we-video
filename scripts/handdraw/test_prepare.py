"""按需运行的预处理回归：仅生成临时测试素材，不渲染视频。"""
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import cKDTree
from prepare import run, clean_line_gray, paint_regions, color_layer


class HanddrawPreparationTests(unittest.TestCase):
    def test_gray_noise_and_color_edge_fragments_are_not_independent_strokes(self):
        gray = np.full((64, 64), 255.)
        gray[10:54, 10] = 0
        gray[10:54, 11] = 230
        gray[3, 50] = 230
        cleaned = clean_line_gray(gray)
        self.assertEqual(cleaned[3, 50], 255)
        self.assertEqual(cleaned[30, 11], 230)
        paint = np.full((64, 64, 3), 255, np.uint8)
        paint[12:52, 15:50] = [230, 150, 70]
        paint[15:45:2, 18:48:2] = [223, 127, 63]
        _, regions = paint_regions(paint, cleaned)
        self.assertLess(len(regions), 10)

    def test_smooth_gradient_uses_one_region_without_changing_source_pixels(self):
        # 渐变跨越多个旧 RGB 档位时，仍应一次连续上色。
        gray = np.full((64, 96), 255.)
        paint = np.full((64, 96, 3), 255, np.uint8)
        paint[12:52, 8:88] = np.c_[np.linspace(60, 220, 80).astype(np.uint8), np.full(80, 160), np.full(80, 80)]
        original = paint.copy()
        mask, regions = paint_regions(paint, gray)
        self.assertEqual(len(regions), 1)
        self.assertEqual(len(regions[0][1]), int(mask.sum()))
        self.assertTrue(np.array_equal(paint, original))

    def test_sharp_color_changes_and_ink_keep_regions_separate(self):
        # 相接的红蓝两色分别落笔；相同颜色被墨线隔开时也不能合并。
        gray = np.full((64, 96), 255.)
        paint = np.full((64, 96, 3), 255, np.uint8)
        paint[12:52, 8:48] = [230, 80, 70]
        paint[12:52, 48:88] = [70, 150, 230]
        _, regions = paint_regions(paint, gray)
        self.assertEqual(len(regions), 2)
        paint[12:52, 48:88] = [230, 80, 70]
        gray[:, 47:49] = 0
        mask, regions = paint_regions(paint, gray)
        self.assertEqual(len(regions), 2)
        self.assertFalse(mask[:, 47:49].any())

    def test_translucent_line_edges_have_color_beneath_and_white_outside(self):
        # 模拟黑线的灰色抗锯齿边缘，成图应与原始彩图一致，避免叠加白边或重复黑线。
        gray = np.full((40, 40), 255.)
        gray[:, 11:14] = [160, 0, 160]
        paint = np.full((40, 40, 3), 255, np.uint8)
        fill = np.array([220, 140, 60], np.uint8)
        paint[:, 14:] = fill
        paint[:, 11] = 160
        paint[:, 12] = 0
        paint[:, 13] = np.rint(fill * (160 / 255)).astype(np.uint8)
        layer = color_layer(paint, gray, edge_margin=3)
        self.assertTrue(np.all(layer[:, 13, :3] == fill))
        self.assertTrue(np.all(layer[:, 13, 3] == 255))
        self.assertFalse(layer[:, :11, 3].any())
        base = np.where(layer[..., 3:4] > 0, layer[..., :3], 255)
        complete = np.rint(base * (gray[..., None] / 255)).astype(np.uint8)
        self.assertTrue(np.array_equal(complete, paint))

    def test_edge_repair_preserves_small_closed_fills_and_open_color_marks(self):
        # 边缘修复范围大于小色区时，也应留下闭合色点和开放线条旁的细笔触。
        gray = np.full((40, 40), 255.)
        gray[:, 8] = 0
        gray[20:28, 20:28] = 0
        gray[22:26, 22:26] = 255
        paint = np.repeat(gray[..., None], 3, axis=2).astype(np.uint8)
        paint[22:26, 22:26] = [230, 90, 70]
        paint[10:18, 9] = [70, 160, 230]
        layer = color_layer(paint, gray, edge_margin=8)
        self.assertTrue(np.all(layer[22:26, 22:26, :3] == [230, 90, 70]))
        self.assertTrue(np.all(layer[22:26, 22:26, 3] == 255))
        self.assertTrue(np.all(layer[10:18, 9, :3] == [70, 160, 230]))
        self.assertFalse(layer[:, :8, 3].any())

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        line = Image.new("RGB", (200, 200), "white")
        ImageDraw.Draw(line).rectangle((30, 40, 160, 160), outline="black", width=3)
        color = line.copy()
        ImageDraw.Draw(color).rectangle((33, 43, 157, 157), fill=(240, 160, 80))
        line.save(self.root / "line.png")
        color.save(self.root / "color.png")

    def tearDown(self):
        self.temp.cleanup()

    def test_layers_and_time_fields_cover_the_complete_image(self):
        run(self.root / "line.png", self.root / "color.png", self.root / "out", "a" * 64)
        report = json.loads((self.root / "out/report.json").read_text())
        motion = json.loads((self.root / "out/motion.json").read_text())
        self.assertGreater(report["minimumDrawMs"], 0)
        self.assertEqual(motion["minimumDrawMs"], report["minimumDrawMs"])
        self.assertEqual(sorted(p[0] for p in motion["points"]), [p[0] for p in motion["points"]])
        self.assertTrue(any(p[3] == 0 for p in motion["points"]))
        self.assertTrue(any(p[3] == 1 for p in motion["points"]))
        self.assertTrue(any(p[3] == 2 for p in motion["points"]))
        line = np.array(Image.open(self.root / "out/line.png"))
        color = np.array(Image.open(self.root / "out/color.png"))
        line_time = np.array(Image.open(self.root / "out/line-time.png"))
        color_time = np.array(Image.open(self.root / "out/color-time.png"))
        self.assertTrue(np.all(line_time[..., 3][line[..., 3] > 0] > 0))
        self.assertTrue(np.all(color_time[..., 3][color[..., 3] > 0] > 0))
        paper = Image.new("RGBA", (200, 200), "white")
        paper.alpha_composite(Image.fromarray(color))
        paper.alpha_composite(Image.fromarray(line))
        self.assertTrue(np.array_equal(np.array(paper.convert("RGB")), np.array(Image.open(self.root / "out/complete.png"))))

    def test_mismatch_and_blank_lineart_are_rejected(self):
        Image.new("RGB", (100, 100), "white").save(self.root / "small.png")
        with self.assertRaisesRegex(ValueError, "尺寸不一致"):
            run(self.root / "line.png", self.root / "small.png", self.root / "out", "a" * 64)
        Image.new("RGB", (200, 200), "white").save(self.root / "blank.png")
        with self.assertRaisesRegex(ValueError, "线稿为空"):
            run(self.root / "blank.png", self.root / "color.png", self.root / "out", "a" * 64)

    def test_solid_arrowhead_and_eye_mask_have_drawable_ink_coverage(self):
        # 局部实心箭头与带白色眼孔的眼罩保留原样，所有墨迹都有近处真实落笔。
        line = Image.new("RGB", (320, 240), "white")
        draw = ImageDraw.Draw(line)
        draw.line((20, 65, 115, 65), fill="black", width=8)
        draw.polygon([(100, 15), (175, 65), (100, 115)], fill="black")
        draw.ellipse((195, 30, 305, 95), fill="black")
        draw.ellipse((205, 48, 235, 70), fill="white")
        draw.ellipse((265, 48, 295, 70), fill="white")
        line.save(self.root / "solid.png")
        run(self.root / "solid.png", self.root / "solid.png", self.root / "out", "b" * 64)
        mask = np.array(line.convert("L")) < 245
        time = np.array(Image.open(self.root / "out/line-time.png"))
        self.assertTrue(np.all(time[..., 3][mask] == 255))
        self.assertTrue(np.all(time[..., 3][~mask] == 0))
        ticks = time[..., 0].astype(np.uint32) | (time[..., 1].astype(np.uint32) << 8) | (time[..., 2].astype(np.uint32) << 16)
        self.assertGreater(len(np.unique(ticks[mask])), 20)
        motion = json.loads((self.root / "out/motion.json").read_text())
        points = np.array([p[1:3] for p in motion["points"] if p[3] == 1])
        ys, xs = np.where(mask)
        self.assertLessEqual(cKDTree(points).query(np.c_[xs, ys])[0].max(), 12)
        self.assertTrue(np.array_equal(np.array(line), np.array(Image.open(self.root / "out/complete.png"))))

    def test_large_black_fill_is_still_rejected(self):
        # 放行局部填黑后，大片涂黑仍保留原来的复杂度保护。
        line = Image.new("RGB", (200, 200), "white")
        ImageDraw.Draw(line).rectangle((25, 25, 175, 175), fill="black")
        line.save(self.root / "filled.png")
        with self.assertRaisesRegex(ValueError, "大片填充"):
            run(self.root / "filled.png", self.root / "filled.png", self.root / "out", "c" * 64)

    def test_redrawn_color_is_rejected(self):
        color = Image.new("RGB", (200, 200), "white")
        ImageDraw.Draw(color).ellipse((60, 20, 190, 120), outline="black", width=3)
        color.save(self.root / "wrong.png")
        with self.assertRaisesRegex(ValueError, "不匹配"):
            run(self.root / "line.png", self.root / "wrong.png", self.root / "out", "a" * 64)


if __name__ == "__main__":
    unittest.main()
