"""Where each value was printed, so the doctor can be shown the line it came from.

Positions leave the pipeline as fractions of their page (0..1). That is the
only unit both readers share: digital PDFs are measured in PDF points, OCR in
pixels of the image PaddleOCR rendered.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import document_processor as dp  # noqa: E402
import ocr_extractor as oe  # noqa: E402

STRIDE = dp._PAGE_Y_STRIDE


class TestNormalizedBox(unittest.TestCase):
    def test_a_box_becomes_page_fractions(self):
        # A4 in PDF points; a value at x 297.5-340, y 421-433 on the first page.
        box = dp._normalized_box([297.5, 421.0, 340.0, 433.0], 0, {0: (595.0, 842.0)})
        self.assertEqual(box, [0.5, 0.5, 0.57143, 0.51425])

    def test_the_page_offset_is_removed(self):
        # Page 3 (index 2): tokens were pushed down by 2 * stride before parsing.
        box = dp._normalized_box([119.0, 2 * STRIDE + 168.4, 238.0, 2 * STRIDE + 252.6], 2, {2: (595.0, 842.0)})
        self.assertEqual(box, [0.2, 0.2, 0.4, 0.3])

    def test_ocr_pixels_scale_by_the_image_size(self):
        # PaddleOCR renders A4 at 1190 x 1684; same place as the first test.
        box = dp._normalized_box([595.0, 842.0, 680.0, 866.0], 0, {0: (1190, 1684)})
        self.assertEqual(box, [0.5, 0.5, 0.57143, 0.51425])

    def test_no_page_size_means_no_box(self):
        self.assertIsNone(dp._normalized_box([1, 2, 3, 4], 0, {}))
        self.assertIsNone(dp._normalized_box([1, 2, 3, 4], 1, {0: (595.0, 842.0)}))
        self.assertIsNone(dp._normalized_box(None, 0, {0: (595.0, 842.0)}))

    def test_a_degenerate_box_is_dropped(self):
        self.assertIsNone(dp._normalized_box([10, 10, 10, 20], 0, {0: (100.0, 100.0)}))


class TestMetricSource(unittest.TestCase):
    STRUCTURED = {
        "sections": [{
            "title": "THYROID PROFILE",
            "tests": [{
                "name": "TSH", "value": "0.997", "unit": "µIU/mL",
                "location": {"page": 5, "row": [34.8, 5 * STRIDE + 331.6, 554.1, 5 * STRIDE + 340.8],
                             "value": [294.8, 5 * STRIDE + 331.6, 316.9, 5 * STRIDE + 340.0]},
            }],
        }]
    }

    def test_metrics_carry_a_one_based_page_and_both_boxes(self):
        [metric] = dp._metrics_from_structured(self.STRUCTURED, 1.0, {5: (595.0, 842.0)})
        self.assertEqual(metric["source"]["page"], 6)
        self.assertEqual(metric["source"]["row"], [0.05849, 0.39382, 0.93126, 0.40475])
        self.assertEqual(metric["source"]["value"], [0.49546, 0.39382, 0.53261, 0.40380])

    def test_without_page_sizes_there_is_no_source(self):
        [metric] = dp._metrics_from_structured(self.STRUCTURED, 1.0)
        self.assertIsNone(metric["source"])

    def test_the_ingest_payload_keeps_the_source(self):
        [metric] = dp._metrics_from_structured(self.STRUCTURED, 1.0, {5: (595.0, 842.0)})
        payload = dp.to_ingest_payload({"metrics": [metric], "status": "success"}, "p/report.pdf")
        self.assertEqual(payload["metrics"][0]["source"], metric["source"])


class TestOcrGeometry(unittest.TestCase):
    def payload(self, **page_extra):
        return {
            "pages": [{
                "page_number": 1,
                "items": [
                    {"text": "Hemoglobin", "confidence": 0.95, "bbox": [100, 400, 300, 424]},
                    {"text": "11.3", "confidence": 0.95, "bbox": [600, 400, 660, 424]},
                    {"text": "g/dL", "confidence": 0.95, "bbox": [760, 400, 820, 424]},
                ],
                "lines": ["Hemoglobin        11.3     g/dL"],
                **page_extra,
            }],
            "overall_avg_confidence": 0.95,
            "total_pages": 1,
        }

    def fill(self, payload):
        return dp._fill_from_ocr(dp._envelope("scan.jpg"), payload)

    def test_real_boxes_with_an_image_size_give_a_source(self):
        envelope = self.fill(self.payload(width=1190, height=1684))
        source = envelope["metrics"][0]["source"]
        self.assertEqual(source["page"], 1)
        self.assertEqual(source["value"], [0.5042, 0.23753, 0.55462, 0.25178])

    def test_no_image_size_gives_no_source(self):
        envelope = self.fill(self.payload())
        self.assertIsNone(envelope["metrics"][0]["source"])

    def test_the_text_only_fallback_never_invents_a_position(self):
        payload = self.payload(width=1190, height=1684)
        for page in payload["pages"]:
            page["items"] = []  # no boxes: columns are guessed from whitespace
        envelope = self.fill(payload)
        self.assertTrue(envelope["metrics"])
        self.assertTrue(all(m["source"] is None for m in envelope["metrics"]))


class TestPageSize(unittest.TestCase):
    def test_size_comes_from_the_image_paddleocr_read(self):
        image = SimpleNamespace(shape=(1684, 1190, 3))
        self.assertEqual(oe.page_size({"doc_preprocessor_res": {"output_img": image}}), (1190, 1684))

    def test_older_result_shapes_give_no_size(self):
        self.assertEqual(oe.page_size({}), (None, None))
        self.assertEqual(oe.page_size([["poly", ("text", 0.9)]]), (None, None))

    def test_the_page_payload_records_it(self):
        page = oe._page_payload(1, [], 1190, 1684)
        self.assertEqual((page["width"], page["height"]), (1190, 1684))


if __name__ == "__main__":
    unittest.main()
