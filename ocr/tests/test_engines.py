"""Tests for the two engine-side fixes: field splitting and OCR result parsing.

`ocr_extractor` defers its paddle imports, so everything below runs without
paddlepaddle or paddleocr installed.
"""

from __future__ import annotations

import sys
import unittest
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ocr_extractor as oe  # noqa: E402
import structure_parser as sp  # noqa: E402


@dataclass(frozen=True)
class Tok:
    text: str
    x0: float
    top: float
    x1: float
    bottom: float
    page: int = 0
    conf: float = 1.0
    source: str = "pdfplumber"


# --------------------------------------------------------------------------
# split_fields / is_section_title
# --------------------------------------------------------------------------
class TestFieldSplitting(unittest.TestCase):
    def ruled_row(self):
        """A ruled table row: cells touch, so gaps alone cannot separate them."""
        return sp.Line(y=100, tokens=[
            Tok("Hemoglobin", 50, 95, 170, 110, source="pdfplumber_table"),
            Tok("11.2", 170, 95, 220, 110, source="pdfplumber_table"),
            Tok("g/dL", 220, 95, 270, 110, source="pdfplumber_table"),
            Tok("12.0 - 15.0", 270, 95, 360, 110, source="pdfplumber_table"),
        ])

    def test_touching_table_cells_stay_separate_fields(self):
        fields = sp.split_fields(self.ruled_row())
        self.assertEqual([f.text for f in fields],
                         ["Hemoglobin", "11.2", "g/dL", "12.0 - 15.0"])

    def test_a_ruled_row_parses_as_a_test_row(self):
        test = sp.parse_test_row(sp.split_fields(self.ruled_row()))
        self.assertEqual(test, {"name": "Hemoglobin", "value": "11.2",
                                "unit": "g/dL", "reference": "12.0 - 15.0", "flag": None,
                                # The whole row, and the value cell on its own.
                                "location": {"page": 0,
                                             "row": [50.0, 95.0, 360.0, 110.0],
                                             "value": [170.0, 95.0, 220.0, 110.0]}})

    def test_plain_words_still_group_by_gap(self):
        line = sp.Line(y=50, tokens=[
            Tok("Jane", 50, 45, 90, 60),
            Tok("Doe", 95, 45, 130, 60),     # 5pt gap - same field
            Tok("31", 300, 45, 320, 60),     # 170pt gap - new field
        ])
        self.assertEqual([f.text for f in sp.split_fields(line)], ["Jane Doe", "31"])

    def test_table_cells_are_identified_by_source(self):
        self.assertTrue(sp.is_table_cell(Tok("x", 0, 0, 1, 1, source="pdfplumber_table")))
        self.assertFalse(sp.is_table_cell(Tok("x", 0, 0, 1, 1, source="pdfplumber")))
        self.assertFalse(sp.is_table_cell(object()))  # duck-typed, no source


class TestSectionTitleVsKeyValue(unittest.TestCase):
    def fields(self, text):
        return [sp.Field(tokens=[Tok(text, 0, 0, len(text) * 6.0, 12)])]

    def test_long_key_value_line_is_not_a_section_title(self):
        # 21 characters - over the length threshold, but still a header field.
        fields = self.fields("Collected: 12/10/2025")
        self.assertFalse(sp.is_section_title(fields))
        self.assertEqual(sp.parse_kv(fields), ("Collected", "12/10/2025"))

    def test_referred_by_reaches_report_meta(self):
        fields = self.fields("Referred By: Dr. S. Rao")
        self.assertFalse(sp.is_section_title(fields))

    def test_a_real_heading_is_still_a_section_title(self):
        self.assertTrue(sp.is_section_title(self.fields("COMPLETE BLOOD COUNT REPORT")))

    def test_short_lines_are_not_titles(self):
        self.assertFalse(sp.is_section_title(self.fields("Age: 31")))

    def test_numbers_are_not_titles(self):
        self.assertFalse(sp.is_section_title(self.fields("123456789012345678")))


# --------------------------------------------------------------------------
# Device resolution
# --------------------------------------------------------------------------
class TestDeviceResolution(unittest.TestCase):
    def setUp(self):
        self._saved = oe.gpu_available
        self.addCleanup(lambda: setattr(oe, "gpu_available", self._saved))
        self._env = oe.os.environ.get(oe.DEVICE_ENV_VAR)
        self.addCleanup(self._restore_env)
        oe.os.environ.pop(oe.DEVICE_ENV_VAR, None)

    def _restore_env(self):
        if self._env is None:
            oe.os.environ.pop(oe.DEVICE_ENV_VAR, None)
        else:
            oe.os.environ[oe.DEVICE_ENV_VAR] = self._env

    def test_gpu_used_when_a_device_is_actually_visible(self):
        oe.gpu_available = lambda: True
        self.assertEqual(oe.resolve_device(), "gpu")
        self.assertEqual(oe.resolve_device("gpu"), "gpu")

    def test_falls_back_to_cpu_when_no_device_is_visible(self):
        # The original hardcoded device="gpu" here, which PaddleOCR rejects.
        oe.gpu_available = lambda: False
        self.assertEqual(oe.resolve_device(), "cpu")
        self.assertEqual(oe.resolve_device("gpu"), "cpu")

    def test_cpu_can_be_forced_over_an_available_gpu(self):
        oe.gpu_available = lambda: True
        self.assertEqual(oe.resolve_device("cpu"), "cpu")
        oe.os.environ[oe.DEVICE_ENV_VAR] = "cpu"
        self.assertEqual(oe.resolve_device(), "cpu")

    def test_missing_paddle_is_not_a_crash(self):
        self.assertFalse(oe.gpu_available())  # paddle genuinely absent here


# --------------------------------------------------------------------------
# Result parsing
# --------------------------------------------------------------------------
def poly(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


class TestPageItems(unittest.TestCase):
    def result(self, rows):
        return {
            "rec_texts": [r[0] for r in rows],
            "rec_scores": [r[1] for r in rows],
            "dt_polys": [r[2] for r in rows],
        }

    def test_reading_order_is_top_to_bottom_then_left_to_right(self):
        # Detection order deliberately scrambled within a row.
        items = oe.page_items(self.result([
            ("11.2", 0.98, poly(500, 100, 560, 120)),
            ("Hemoglobin", 0.99, poly(100, 100, 300, 120)),
            ("Name: Jane Doe", 0.97, poly(100, 40, 400, 60)),
        ]))
        self.assertEqual([i["text"] for i in items],
                         ["Name: Jane Doe", "Hemoglobin", "11.2"])

    def test_low_confidence_boxes_are_dropped(self):
        items = oe.page_items(self.result([
            ("Hemoglobin", 0.99, poly(100, 100, 300, 120)),
            ("smudge", 0.21, poly(100, 140, 300, 160)),
        ]), min_confidence=0.6)
        self.assertEqual([i["text"] for i in items], ["Hemoglobin"])

    def test_bounding_boxes_are_preserved(self):
        items = oe.page_items(self.result([("HGB", 0.9, poly(100, 100, 300, 120))]))
        self.assertEqual(items[0]["bbox"], [100.0, 100.0, 300.0, 120.0])

    def test_blank_and_whitespace_text_is_skipped(self):
        items = oe.page_items(self.result([
            ("   ", 0.99, poly(0, 0, 10, 10)),
            ("HGB", 0.99, poly(0, 20, 10, 30)),
        ]))
        self.assertEqual([i["text"] for i in items], ["HGB"])

    def test_missing_polygons_do_not_crash(self):
        items = oe.page_items({"rec_texts": ["A", "B"], "rec_scores": [0.9, 0.9], "dt_polys": []})
        self.assertEqual([i["text"] for i in items], ["A", "B"])
        self.assertIsNone(items[0]["bbox"])

    def test_legacy_2x_result_shape_is_still_read(self):
        legacy = [
            [poly(100, 200, 300, 220), ("Glucose", 0.95)],
            [poly(100, 100, 300, 120), ("Hemoglobin", 0.95)],
        ]
        self.assertEqual([i["text"] for i in oe.page_items(legacy)],
                         ["Hemoglobin", "Glucose"])

    def test_empty_page(self):
        self.assertEqual(oe.page_items(None), [])
        self.assertEqual(oe.page_items({}), [])

    def test_bbox_from_poly_rejects_junk(self):
        self.assertIsNone(oe.bbox_from_poly(None))
        self.assertIsNone(oe.bbox_from_poly([]))
        self.assertIsNone(oe.bbox_from_poly("nonsense"))


class TestPagePayload(unittest.TestCase):
    def test_payload_keeps_lines_text_and_geometry(self):
        items = [
            {"text": "HGB", "confidence": 0.9, "bbox": [0, 0, 10, 10]},
            {"text": "11.2", "confidence": 0.8, "bbox": [20, 0, 30, 10]},
        ]
        page = oe._page_payload(1, items)
        self.assertEqual(page["page_number"], 1)
        self.assertEqual(page["line_count"], 2)
        self.assertEqual(page["lines"], ["HGB", "11.2"])
        self.assertEqual(page["text"], "HGB\n11.2")
        self.assertEqual(page["avg_confidence"], 0.85)
        self.assertEqual(page["items"], items)

    def test_empty_page_has_zero_confidence_not_a_crash(self):
        page = oe._page_payload(2, [])
        self.assertEqual(page["avg_confidence"], 0.0)
        self.assertEqual(page["text"], "")


class TestReadingOrder(unittest.TestCase):
    """Regression cover for a real page whose header came out scrambled."""

    def result(self, rows):
        return {"rec_texts": [r[0] for r in rows],
                "rec_scores": [r[1] for r in rows],
                "dt_polys": [r[2] for r in rows]}

    def test_row_jitter_does_not_interleave_columns(self):
        # Real y values off a 200dpi scan: the four header cells differ by a
        # few pixels, which an exact sort on `top` orders by jitter, not by x.
        items = oe.page_items(self.result([
            ("Result", 0.99, poly(721, 585, 809, 625)),
            ("Test Name", 0.99, poly(253, 586, 392, 625)),
            ("Bio. Ref. Interval", 0.99, poly(1116, 587, 1327, 625)),
            ("Units", 0.99, poly(919, 588, 989, 624)),
        ]))
        self.assertEqual([i["text"] for i in items],
                         ["Test Name", "Result", "Units", "Bio. Ref. Interval"])

    def test_rows_stay_in_top_to_bottom_order(self):
        items = oe.page_items(self.result([
            ("11.2", 0.99, poly(520, 640, 590, 674)),
            ("Hemoglobin", 0.99, poly(251, 638, 403, 674)),
            ("Jane Doe", 0.99, poly(215, 218, 426, 250)),
        ]))
        self.assertEqual([i["text"] for i in items], ["Jane Doe", "Hemoglobin", "11.2"])

    def test_boxes_without_geometry_keep_detection_order_at_the_end(self):
        items = oe.page_items({
            "rec_texts": ["no box", "has box"],
            "rec_scores": [0.9, 0.9],
            "dt_polys": [None, poly(100, 100, 200, 120)],
        })
        self.assertEqual([i["text"] for i in items], ["has box", "no box"])


class TestKeyNormalization(unittest.TestCase):
    def test_exact_labels_map(self):
        self.assertEqual(sp.normalize_key("Lab No."), "lab_no")
        self.assertEqual(sp.normalize_key("Referred By:"), "referred_by")

    def test_ocr_dropped_spaces_still_map(self):
        # PaddleOCR returns "LabNo.:A-4472" for a real scan; without squashed
        # matching this lands under the junk key "labno" and never reaches
        # patient.lab_no.
        self.assertEqual(sp.normalize_key("LabNo."), "lab_no")
        self.assertEqual(sp.normalize_key("ReferredBy"), "referred_by")
        self.assertEqual(sp.normalize_key("PatientName"), "name")

    def test_unknown_labels_still_become_slugs(self):
        self.assertEqual(sp.normalize_key("Some Other Field"), "some_other_field")


if __name__ == "__main__":
    unittest.main(verbosity=2)
