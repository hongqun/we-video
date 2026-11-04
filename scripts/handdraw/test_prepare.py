"""按需运行的预处理回归：仅生成临时测试素材，不渲染视频。"""
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from prepare import run, clean_line_gray, paint_regions


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

    def test_redrawn_color_is_rejected(self):
        color = Image.new("RGB", (200, 200), "white")
        ImageDraw.Draw(color).ellipse((60, 20, 190, 120), outline="black", width=3)
        color.save(self.root / "wrong.png")
        with self.assertRaisesRegex(ValueError, "不匹配"):
            run(self.root / "line.png", self.root / "wrong.png", self.root / "out", "a" * 64)


if __name__ == "__main__":
    unittest.main()
