"""Regression checks for transparent motion rendering; no app dependencies."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import numpy as np
from PIL import Image, ImageDraw

from prepare_bilby_motion import interpolate_frames


class MovingAlphaTest(unittest.TestCase):
    def test_color_and_alpha_share_motion_without_hidden_rgb_bleed(self):
        # Hidden white RGB is intentional: it must never bleed through the
        # transparent edge when the foreground moves or is interpolated.
        first = Image.new('RGBA', (320, 320), (255, 255, 255, 0))
        draw = ImageDraw.Draw(first)
        draw.rounded_rectangle((100, 100, 180, 180), radius=12, fill=(75, 120, 200, 255))
        draw.rectangle((123, 121, 130, 129), fill=(30, 50, 90, 255))
        draw.rectangle((150, 146, 157, 154), fill=(180, 200, 230, 255))
        second = Image.new('RGBA', first.size, (255, 255, 255, 0))
        second.paste(first, (8, 0))
        original = first.tobytes()
        with TemporaryDirectory() as directory:
            rendered = interpolate_frames([first, second], 4, Path(directory))
        self.assertEqual(first.tobytes(), original)
        self.assertEqual(rendered[0].tobytes(), original)
        middle = np.array(rendered[1])
        source = np.array(first)
        opaque = middle[:, :, 3] >= 250
        yy, xx = np.nonzero(opaque)
        self.assertAlmostEqual(float(np.mean(xx)), 144, delta=1.0)
        self.assertAlmostEqual(float(np.mean(yy)), 140, delta=1.0)
        # A plain alpha crossfade shrinks the opaque intersection by ~10%.
        self.assertGreater(opaque.sum() / (source[:, :, 3] >= 250).sum(), .97)
        self.assertLess(opaque.sum() / (source[:, :, 3] >= 250).sum(), 1.03)
        edge = (middle[:, :, 3] > 10) & (middle[:, :, 3] < 245)
        self.assertTrue(edge.any())
        self.assertLessEqual(int(middle[edge, :3].max()), 205)


if __name__ == '__main__':
    unittest.main()
