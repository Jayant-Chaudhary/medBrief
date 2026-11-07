"""Rotated photos are read upright: EXIF orientation, then page classification.

Synthetic images only; no PaddleOCR models are loaded (the classifier is faked).
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import ocr_extractor as oe  # noqa: E402

EXIF_ORIENTATION_TAG = 0x0112


def _marked_image(width: int = 40, height: int = 20) -> Image.Image:
    """A landscape image with a red top-left corner, so rotation is observable."""
    img = Image.new("RGB", (width, height), (255, 255, 255))
    for x in range(5):
        for y in range(5):
            img.putpixel((x, y), (255, 0, 0))
    return img


class FakeClassifier:
    def __init__(self, label):
        self.label = label
        self.calls = 0

    def predict(self, image):
        self.calls += 1
        return [{"label_names": [self.label], "scores": [0.99]}]


class TempDirCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)


class TestLoadUprightImage(TempDirCase):
    def test_applies_exif_rotation_tag(self):
        # Orientation 6 = "rotate 90 CW to display": stored landscape, shown portrait.
        path = self.dir / "phone.jpg"
        exif = Image.Exif()
        exif[EXIF_ORIENTATION_TAG] = 6
        _marked_image().save(path, format="JPEG", exif=exif, quality=95)

        array = oe.load_upright_image(str(path))
        self.assertEqual(array.shape[:2], (40, 20))  # (height, width): now portrait

    def test_image_without_exif_is_unchanged_and_bgr(self):
        path = self.dir / "scan.png"
        _marked_image().save(path, format="PNG")

        array = oe.load_upright_image(str(path))
        self.assertEqual(array.shape, (20, 40, 3))
        # Red in RGB is (0, 0, 255) in BGR, which PaddleOCR expects.
        self.assertEqual(tuple(array[0, 0]), (0, 0, 255))
        self.assertTrue(array.flags["C_CONTIGUOUS"])

    def test_pdf_is_left_to_paddleocr(self):
        path = self.dir / "report.pdf"
        path.write_bytes(b"%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n")
        self.assertIsNone(oe.load_upright_image(str(path)))


class TestCorrectOrientation(unittest.TestCase):
    def setUp(self):
        self.image = np.zeros((20, 40, 3), dtype=np.uint8)
        self.image[0, 0] = 255  # marker at top-left

    def test_upright_page_is_untouched(self):
        out, angle = oe.correct_orientation(self.image, FakeClassifier("0"))
        self.assertEqual(angle, 0)
        self.assertIs(out, self.image)

    def test_right_angles_match_paddle_counter_clockwise_turn(self):
        for label, k in (("90", 1), ("180", 2), ("270", 3)):
            with self.subTest(label=label):
                out, angle = oe.correct_orientation(self.image, FakeClassifier(label))
                self.assertEqual(angle, int(label))
                np.testing.assert_array_equal(out, np.rot90(self.image, k=k))
                self.assertTrue(out.flags["C_CONTIGUOUS"])

    def test_90_degrees_swaps_dimensions(self):
        out, _ = oe.correct_orientation(self.image, FakeClassifier("90"))
        self.assertEqual(out.shape[:2], (40, 20))

    def test_unexpected_or_missing_label_is_ignored(self):
        for label in ("45", "garbage", None):
            with self.subTest(label=label):
                out, angle = oe.correct_orientation(self.image, FakeClassifier(label))
                self.assertEqual(angle, 0)
                self.assertIs(out, self.image)

    def test_empty_prediction_is_ignored(self):
        classifier = mock.Mock()
        classifier.predict.return_value = iter(())
        out, angle = oe.correct_orientation(self.image, classifier)
        self.assertEqual(angle, 0)
        self.assertIs(out, self.image)


class TestAutorotateFlag(unittest.TestCase):
    def _env(self, **values):
        keys = ("OCR_IMAGE_AUTOROTATE", "OCR_DOC_ORIENTATION", "OCR_AUTOROTATE")
        env = {k: v for k, v in os.environ.items() if k not in keys}
        env.update(values)
        return mock.patch.dict(os.environ, env, clear=True)

    def test_on_by_default(self):
        with self._env():
            self.assertTrue(oe.image_autorotate_enabled())

    def test_can_be_disabled(self):
        with self._env(OCR_IMAGE_AUTOROTATE="false"):
            self.assertFalse(oe.image_autorotate_enabled())

    def test_off_when_paddle_page_orientation_is_on(self):
        for name in ("OCR_DOC_ORIENTATION", "OCR_AUTOROTATE"):
            with self.subTest(name=name), self._env(**{name: "true"}):
                self.assertFalse(oe.image_autorotate_enabled())


class TestPrepareOcrInput(TempDirCase):
    def test_photo_is_classified_and_rotated(self):
        path = self.dir / "sideways.png"
        _marked_image().save(path, format="PNG")
        classifier = FakeClassifier("270")
        with mock.patch.object(oe, "image_autorotate_enabled", return_value=True), \
                mock.patch.object(oe, "get_orientation_classifier", return_value=classifier):
            image, angle = oe.prepare_ocr_input(str(path), "cpu")
        self.assertEqual(angle, 270)
        self.assertEqual(image.shape[:2], (40, 20))
        self.assertEqual(classifier.calls, 1)

    def test_pdf_path_passes_through_without_classifier(self):
        path = self.dir / "report.pdf"
        path.write_bytes(b"%PDF-1.4\n%%EOF\n")
        with mock.patch.object(oe, "get_orientation_classifier") as get_classifier:
            value, angle = oe.prepare_ocr_input(str(path), "cpu")
        self.assertEqual((value, angle), (str(path), 0))
        get_classifier.assert_not_called()

    def test_disabled_autorotate_still_applies_exif(self):
        path = self.dir / "phone.jpg"
        exif = Image.Exif()
        exif[EXIF_ORIENTATION_TAG] = 8
        _marked_image().save(path, format="JPEG", exif=exif)
        with mock.patch.object(oe, "image_autorotate_enabled", return_value=False), \
                mock.patch.object(oe, "get_orientation_classifier") as get_classifier:
            image, angle = oe.prepare_ocr_input(str(path), "cpu")
        self.assertEqual(angle, 0)
        self.assertEqual(image.shape[:2], (40, 20))
        get_classifier.assert_not_called()


class TestExtractPassesUprightImage(TempDirCase):
    def test_extract_feeds_rotated_array_and_reports_rotation(self):
        path = self.dir / "sideways.png"
        _marked_image().save(path, format="PNG")
        seen = {}

        class FakeOcr:
            def predict(self, value):
                seen["input"] = value
                return [{"rec_texts": [], "rec_scores": [], "rec_polys": []}]

        with mock.patch.object(oe, "get_ocr", return_value=FakeOcr()), \
                mock.patch.object(oe, "image_autorotate_enabled", return_value=True), \
                mock.patch.object(oe, "get_orientation_classifier", return_value=FakeClassifier("90")):
            result = oe.extract_and_format(str(path), device="cpu")

        self.assertIsInstance(seen["input"], np.ndarray)
        self.assertEqual(seen["input"].shape[:2], (40, 20))
        self.assertEqual(result["pages"][0]["rotation_degrees"], 90)


if __name__ == "__main__":
    unittest.main()
