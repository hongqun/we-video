"""本地预处理回归，仅在明确要求时执行，不调用百炼或视频渲染。"""
import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from compile import line_data, measure, ownership
from handwriting import build_label


class CompilerTests(unittest.TestCase):
    def test_line_budget_and_empty_input(self):
        with tempfile.TemporaryDirectory() as root:
            file = Path(root) / 'line.png'
            image = Image.new('RGB', (240, 240), 'white')
            ImageDraw.Draw(image).ellipse((35, 35, 205, 205), outline='black', width=3)
            image.save(file)
            self.assertGreater(measure(file)['minimumLineMs'], 0)
            Image.new('RGB', (240, 240), 'white').save(file)
            with self.assertRaisesRegex(ValueError, '为空'):
                line_data(file)

    def test_semantic_parts_are_exclusive(self):
        mask = np.ones((20, 20), bool)
        result = ownership(mask.shape, [{'box': [0, 0, 1, 1]}, {'box': [.25, .25, .5, .5]}], mask)
        self.assertEqual(result[10, 10], 1)
        self.assertEqual(result[0, 0], 0)
        self.assertTrue(np.all(result >= 0))

    def test_missing_parts_are_not_silently_filled(self):
        with self.assertRaisesRegex(ValueError, '遗漏'):
            ownership((20, 20), [{'box': [0, 0, .2, .2]}], np.ones((20, 20), bool))

    def test_chinese_and_mixed_text_have_strokes(self):
        layer, times, points, report = build_label({'id': 'label', 'text': '太阳 API 2', 'box': [0, 0, 1, 1], 'fontSize': .08}, 400, 100)
        self.assertTrue(layer[..., 3].any())
        self.assertTrue(np.isfinite(times[layer[..., 3] > 0]).all())
        self.assertGreater(len(points), 2)
        self.assertGreater(report['requiredMs'], 0)
        self.assertEqual(report['mode'], 'handwritten_font')
        self.assertEqual(report['font'], 'ZCOOL KuaiLe')

    def test_text_must_fit_its_box(self):
        with self.assertRaisesRegex(ValueError, '超出文字框'):
            build_label({'id': 'label', 'text': '太阳照耀整个世界', 'box': [0, 0, 1, 1], 'fontSize': .9}, 80, 30)


if __name__ == '__main__':
    unittest.main()
