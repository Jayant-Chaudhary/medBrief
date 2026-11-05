"""
Layouts and failure modes seen on real lab reports and real deployments.

Each test pins one case that used to be dropped, misfiled or corrupted:
flagged results, Indian digit grouping, qualitative results, serial-number
columns, "Note:" blocks, printed date formats, the CLI's stdout contract and
the PaddleOCR 3.x result shape. Runs with neither engine installed.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import types
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
OCR_DIR = HERE.parent
sys.path.insert(0, str(OCR_DIR))
sys.path.insert(0, str(HERE))

import document_processor as dp  # noqa: E402
import ocr_extractor as oe  # noqa: E402
from structure_parser import structure_document  # noqa: E402
from test_document_processor import (  # noqa: E402
    FakeDocumentResult,
    TempFileCase,
    install_stubs,
    line_tokens,
    ocr_payload,
)


def tests_from_lines(*lines: str, pages: list[list[str]] | None = None) -> tuple[list, dict]:
    """Structure OCR text lines; return (flattened tests, structured doc)."""
    pages = pages or [list(lines)]
    payload = {"pages": [{"page_number": i + 1, "lines": p} for i, p in enumerate(pages)]}
    tokens, layout = dp._tokens_from_ocr_text(payload)
    doc = structure_document(tokens, **layout)
    # Row positions are covered by test_source_location.py; these tests are
    # about what was read, so the location is left out of the comparison.
    tests = [{k: v for k, v in t.items() if k != "location"} for s in doc["sections"] for t in s["tests"]]
    return tests, doc


# --------------------------------------------------------------------------
# Test rows
# --------------------------------------------------------------------------
class TestFlaggedResults(unittest.TestCase):
    def test_flag_column_is_not_mistaken_for_the_unit(self):
        tests, _ = tests_from_lines("Hemoglobin        11.2     L     g/dL      12.0 - 15.5")
        self.assertEqual(tests, [{"name": "Hemoglobin", "value": "11.2", "unit": "g/dL",
                                  "reference": "12.0 - 15.5", "flag": "L"}])

    def test_flag_glued_to_the_value_is_split_off(self):
        for printed, flag in (("11.2 L", "L"), ("11.2L", "L"), ("*11.2", "*"),
                              ("11.2 High", "High"), ("↑11.2", "↑")):
            with self.subTest(printed=printed):
                tests, _ = tests_from_lines(f"Hemoglobin        {printed}      g/dL      12.0 - 15.5")
                self.assertEqual(len(tests), 1)
                self.assertEqual(tests[0]["value"], "11.2")
                self.assertEqual(tests[0]["flag"], flag)
                self.assertEqual(tests[0]["unit"], "g/dL")

    def test_unflagged_value_has_no_flag(self):
        tests, _ = tests_from_lines("Glucose Fasting   92       mg/dL     70 - 100")
        self.assertIsNone(tests[0]["flag"])


class TestValueFormats(unittest.TestCase):
    def test_indian_digit_grouping(self):
        tests, _ = tests_from_lines("Platelet Count    1,50,000       /cumm     1,50,000 - 4,10,000")
        self.assertEqual(len(tests), 1)
        self.assertEqual(tests[0]["value"], "1,50,000")
        self.assertEqual(tests[0]["unit"], "/cumm")

    def test_western_digit_grouping(self):
        tests, _ = tests_from_lines("WBC Count    7,500     /cumm     4,000 - 11,000")
        self.assertEqual(tests[0]["value"], "7,500")

    def test_qualitative_results(self):
        for result in ("Non Reactive", "Negative", "Positive", "Pale Yellow", "Nil"):
            with self.subTest(result=result):
                tests, _ = tests_from_lines(f"HBsAg             {result}")
                self.assertEqual(tests, [{"name": "HBsAg", "value": result, "unit": None,
                                          "reference": None, "flag": None}])

    def test_serial_number_column_is_dropped(self):
        tests, _ = tests_from_lines("1     Hemoglobin        13.5     g/dL      12.0 - 15.5",
                                    "12.   Glucose Fasting   92       mg/dL     70 - 100")
        self.assertEqual([t["name"] for t in tests], ["Hemoglobin", "Glucose Fasting"])
        self.assertEqual(tests[0]["value"], "13.5")

    def test_a_number_alone_in_front_is_still_not_a_test(self):
        tests, _ = tests_from_lines("2025     13.5")
        self.assertEqual(tests, [])


# --------------------------------------------------------------------------
# Notes / comments blocks
# --------------------------------------------------------------------------
class TestNotesBlocks(unittest.TestCase):
    def test_a_test_row_after_a_note_ends_the_note(self):
        tests, doc = tests_from_lines(
            "Hemoglobin        13.5     g/dL      12.0 - 15.5",
            "Note:",
            "Fasting sample collected at 8 AM",
            "Glucose Fasting   92       mg/dL     70 - 100",
        )
        self.assertEqual([t["name"] for t in tests], ["Hemoglobin", "Glucose Fasting"])
        self.assertEqual(doc["notes"], ["Fasting sample collected at 8 AM"])

    def test_note_mode_does_not_cross_a_page_break(self):
        tests, doc = tests_from_lines(pages=[
            ["Hemoglobin        13.5     g/dL      12.0 - 15.5", "Comments:", "Repeat in 3 months"],
            ["Thyroid Profile", "TSH               2.1      uIU/mL    0.4 - 4.0"],
        ])
        self.assertEqual([t["name"] for t in tests], ["Hemoglobin", "TSH"])
        self.assertEqual(doc["comments"], ["Repeat in 3 months"])


# --------------------------------------------------------------------------
# Report date
# --------------------------------------------------------------------------
class TestReportDate(unittest.TestCase):
    def parse(self, raw):
        return dp._parse_report_date({"report_meta": {"collected_at": raw}})

    def test_printed_formats(self):
        cases = {
            "12/10/2025": "2025-10-12",
            "12/10/2025 10:30:00AM": "2025-10-12",
            "12-Oct-2025": "2025-10-12",
            "12/Oct/2025 10:30": "2025-10-12",
            "12 October 2025": "2025-10-12",
            "12/10/25": "2025-10-12",
            "12-Oct-25": "2025-10-12",
            "2025-10-12": "2025-10-12",
            "Oct 12, 2025": "2025-10-12",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(self.parse(raw), expected)

    def test_day_first_wins_when_both_readings_are_valid(self):
        self.assertEqual(self.parse("05/10/2025"), "2025-10-05")

    def test_month_first_only_when_day_first_is_impossible(self):
        self.assertEqual(self.parse("10/25/2025"), "2025-10-25")


# --------------------------------------------------------------------------
# Routing
# --------------------------------------------------------------------------
class TestSniffing(TempFileCase):
    def test_jpeg_containing_pdf_marker_is_still_an_image(self):
        path = self.tmp / "photo.jpg"
        path.write_bytes(b"\xff\xd8\xff\xe1" + b"Exif %PDF-1.4 junk" + b"\x00" * 64)
        self.assertEqual(dp.sniff_magic(path), "image")


class TestZeroMetrics(TempFileCase):
    def test_ocr_text_without_test_rows_is_partial_not_success(self):
        install_stubs(self, ocr=ocr_payload(lines=["Windows Installer",
                                                   "This installation package could not be opened."]))
        result = dp.process_document(self.make_png())
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["metrics"], [])
        self.assertTrue(any("no test results" in w for w in result["warnings"]))

    def test_digital_pdf_without_test_rows_is_retried_through_ocr(self):
        # A digital letterhead over a scanned body: text, but no test rows.
        header_only = line_tokens("City Diagnostics Lab  Page 1 of 1", page=0, top=20)
        calls = install_stubs(self, digital=FakeDocumentResult(tokens=header_only))
        result = dp.process_document(self.make_pdf())
        self.assertEqual(calls["ocr"], 1)
        self.assertEqual(result["engine"], "ocr")
        self.assertEqual([m["key"] for m in result["metrics"]], ["Hemoglobin"])
        self.assertTrue(result["routing"]["fallback"])

    def test_digital_pdf_with_test_rows_is_not_ocred(self):
        tokens = line_tokens("Hemoglobin  11.2  g/dL  12.0-15.0", page=0, top=130)
        calls = install_stubs(self, digital=FakeDocumentResult(tokens=tokens))
        result = dp.process_document(self.make_pdf())
        self.assertEqual(calls["ocr"], 0)
        self.assertEqual(result["status"], "success")

    def test_failed_ocr_retry_keeps_the_digital_reading(self):
        header_only = line_tokens("City Diagnostics Lab", page=0, top=20)
        install_stubs(self, digital=FakeDocumentResult(tokens=header_only),
                      ocr_raises=RuntimeError("no paddle"))
        result = dp.process_document(self.make_pdf())
        self.assertEqual(result["engine"], "digital")
        self.assertEqual(result["status"], "partial")


# --------------------------------------------------------------------------
# PaddleOCR 3.x result shape
# --------------------------------------------------------------------------
class TestRecPolys(unittest.TestCase):
    def test_rec_polys_are_paired_with_rec_texts_not_dt_polys(self):
        box = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]  # noqa: E731
        result = {
            "rec_texts": ["Hemoglobin", "13.5"],
            "rec_scores": [0.99, 0.98],
            # Three detections, one of which recognition filtered out.
            "dt_polys": [box(0, 0, 5, 5), box(10, 100, 90, 120), box(200, 100, 240, 120)],
            "rec_polys": [box(10, 100, 90, 120), box(200, 100, 240, 120)],
        }
        items = oe.page_items(result, min_confidence=0.5)
        self.assertEqual([i["text"] for i in items], ["Hemoglobin", "13.5"])
        self.assertEqual(items[0]["bbox"], [10.0, 100.0, 90.0, 120.0])

    def test_dt_polys_still_used_when_rec_polys_is_absent(self):
        result = {"rec_texts": ["A"], "rec_scores": [0.9],
                  "dt_polys": [[[1, 2], [3, 2], [3, 4], [1, 4]]]}
        self.assertEqual(oe.page_items(result)[0]["bbox"], [1.0, 2.0, 3.0, 4.0])


class TestPaddleConstruction(unittest.TestCase):
    def setUp(self):
        self.created = []
        fake = types.ModuleType("paddleocr")
        fake.PaddleOCR = lambda **kwargs: self.created.append(kwargs) or object()
        saved = sys.modules.get("paddleocr")
        sys.modules["paddleocr"] = fake
        oe._ocr_instances.clear()

        def restore():
            oe._ocr_instances.clear()
            if saved is None:
                sys.modules.pop("paddleocr", None)
            else:
                sys.modules["paddleocr"] = saved

        self.addCleanup(restore)

    def test_doc_unwarping_and_orientation_are_off_by_default(self):
        oe.get_ocr("cpu")
        self.assertFalse(self.created[0]["use_doc_unwarping"])
        self.assertFalse(self.created[0]["use_doc_orientation_classify"])

    def test_instance_is_built_once(self):
        oe.get_ocr("cpu")
        oe.get_ocr("cpu")
        self.assertEqual(len(self.created), 1)


# --------------------------------------------------------------------------
# CLI contract: stdout is one JSON document, nothing else
# --------------------------------------------------------------------------
class TestCliStdout(TempFileCase):
    NOISY_ENGINE = textwrap.dedent('''
        import os

        def verify_gpu_status():
            print("GPU status banner")
            return "cpu"

        def extract_and_format_pdf_gpu(path, min_confidence=0.6):
            # What Paddle's C++ runtime does: write straight to descriptor 1.
            os.write(1, b"ReduceMeanCheckIfOneDNNSupport\\n")
            print("python-level noise")
            return {
                "total_pages": 1, "overall_avg_confidence": 0.95,
                "pages": [{"page_number": 1, "avg_confidence": 0.95,
                           "lines": ["Hemoglobin  11.2  g/dL  12.0-15.0"]}],
            }
    ''')

    def test_engine_noise_never_reaches_stdout(self):
        stub_dir = self.tmp / "stubs"
        stub_dir.mkdir()
        (stub_dir / "ocr_extractor.py").write_text(self.NOISY_ENGINE, encoding="utf-8")
        image = self.make_png()

        code = (
            "import sys;"
            f"sys.path[:0] = [{str(stub_dir)!r}, {str(OCR_DIR)!r}];"
            "import document_processor as d;"
            f"sys.exit(d._main([{str(image)!r}, '--storage-path', 'lab-reports/x.png']))"
        )
        proc = subprocess.run([sys.executable, "-c", code], capture_output=True, timeout=60)

        self.assertEqual(proc.returncode, 0, proc.stderr.decode(errors="replace"))
        payload = json.loads(proc.stdout.decode("ascii"))
        self.assertEqual(payload["metrics"][0]["key"], "Hemoglobin")
        self.assertIn(b"ReduceMeanCheckIfOneDNNSupport", proc.stderr)
        self.assertIn(b"python-level noise", proc.stderr)


if __name__ == "__main__":
    unittest.main()
