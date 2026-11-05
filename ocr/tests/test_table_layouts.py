"""Layouts that used to lose whole sections of a digital lab report.

Found on a real 10-page Dr Lal PathLabs report, where 21 of 57 values went
missing:

- Boxes ruled only on the outside (HbA1c, thyroid, lipid) came back from
  pdfplumber as one cell holding the whole block.
- Sub-rows with no rules between them (differential and absolute counts)
  came back as stacked cells: "87.10⏎11.40⏎0.90".
- Interpretation boxes drawn with "|" and "-" were parsed as test rows.
- Absolute counts printed bare ("Neutrophils 6.97 thou/mm3") read as the
  percentage test.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import document_processor as dp  # noqa: E402
from test_real_world import tests_from_lines  # noqa: E402

try:
    import digital_extractor as de  # needs pdfplumber
except ImportError:  # pragma: no cover - the engine is optional in CI
    de = None


def fake_table(rows):
    """A pdfplumber-like table: each row has `.cells` bboxes, plus the text matrix."""
    table_rows, matrix = [], []
    for r, texts in enumerate(rows):
        cells = [(c * 100.0, r * 20.0, c * 100.0 + 100, r * 20.0 + 20) for c in range(len(texts))]
        table_rows.append(SimpleNamespace(cells=cells))
        matrix.append(texts)
    return SimpleNamespace(rows=table_rows), matrix


@unittest.skipIf(de is None, "pdfplumber not installed")
class TestMultilineCells(unittest.TestCase):
    def test_a_cell_with_several_lines_is_recognised(self):
        self.assertTrue(de.is_multiline_cell("87.10\n11.40\n0.90"))
        self.assertTrue(de.is_multiline_cell("HbA1c 5.4 % 4.00 - 5.60\nEstimated average glucose (eAG) 108 mg/dL"))
        self.assertFalse(de.is_multiline_cell("12.20"))
        self.assertFalse(de.is_multiline_cell("Hemoglobin\n"))  # a trailing break is not a second line
        self.assertFalse(de.is_multiline_cell(None))

    def test_multiline_cells_are_left_to_word_extraction(self):
        table, matrix = fake_table([
            ["Hemoglobin", "12.20", "g/dL", "12.00 - 15.00"],
            ["Differential Leucocyte Count (DLC)\nSegmented Neutrophils\nLymphocytes", "87.10\n11.40", "%\n%", ""],
        ])
        kept: list = []
        tokens = de.tokens_from_table_matrix(table, matrix, 0, cell_bboxes=kept)
        self.assertEqual([t.text for t in tokens], ["Hemoglobin", "12.20", "g/dL", "12.00 - 15.00"])
        # Only the cells that became tokens are excluded from word extraction,
        # so the stacked rows are read line by line with their positions.
        self.assertEqual(len(kept), 4)
        self.assertTrue(all(bbox[1] == 0.0 for bbox in kept))

    def test_a_box_ruled_only_outside_yields_no_block_token(self):
        table, matrix = fake_table([
            ["LIPID PROFILE BASIC, SERUM\n(Spectrophotometry)"],
            ["Cholesterol Total 114 mg/dL <200.00\nTriglycerides 55 mg/dL <150.00"],
        ])
        kept: list = []
        self.assertEqual(de.tokens_from_table_matrix(table, matrix, 0, cell_bboxes=kept), [])
        self.assertEqual(kept, [])


class TestInterpretationBoxes(unittest.TestCase):
    def test_pipe_drawn_rows_are_not_tests(self):
        tests, _ = tests_from_lines(
            "Vitamin D, 25 Hydroxy        51.85      nmol/L      75.00 - 250.00",
            "| LEVEL         | REFERENCE RANGE IN nmol/L | COMMENTS |",
            "|--------------|---------------------------|----------|",
            "| Insufficient |        50-74              | Vitamin D concentration which normalizes |",
            "| HbA1c in %   | 4.0-5.6 | 5.7-6.4 | >= 6.5 | <7.0 |",
        )
        self.assertEqual([t["name"] for t in tests], ["Vitamin D, 25 Hydroxy"])

    def test_page_footers_are_not_tests_even_when_misread(self):
        for footer in ("Page 1 of 3", "Hage 1 of 3        9", "Page 2/10"):
            with self.subTest(footer=footer):
                tests, _ = tests_from_lines("Hemoglobin        11.3     g/dL     12.00 - 16.00", footer)
                self.assertEqual([t["name"] for t in tests], ["Hemoglobin"])

    def test_a_real_row_is_untouched(self):
        tests, _ = tests_from_lines("Platelet Counts     2.01     lakh/cu.mm     1.50 - 4.50")
        self.assertEqual(tests[0]["value"], "2.01")


class TestAbsoluteCounts(unittest.TestCase):
    def test_bare_white_cell_names_under_an_absolute_heading_are_qualified(self):
        for name in ("Neutrophils", "Lymphocytes", "Monocytes", "Eosinophils", "Basophils"):
            with self.subTest(name=name):
                self.assertEqual(dp._qualified_name(name, "Absolute Leucocyte Count"), f"Absolute {name}")

    def test_other_tests_and_other_sections_keep_their_names(self):
        self.assertEqual(dp._qualified_name("Platelet Count", "Absolute Leucocyte Count"), "Platelet Count")
        self.assertEqual(dp._qualified_name("Absolute Neutrophils", "Absolute Leucocyte Count"), "Absolute Neutrophils")
        self.assertEqual(dp._qualified_name("Lymphocytes", "Differential Leucocyte Count (DLC)"), "Lymphocytes")
        self.assertEqual(dp._qualified_name("Neutrophils", None), "Neutrophils")

    def test_metrics_carry_the_qualified_name(self):
        structured = {
            "sections": [
                {"title": "Differential Leucocyte Count (DLC)", "tests": [{"name": "Lymphocytes", "value": "11.40", "unit": "%"}]},
                {"title": "Absolute Leucocyte Count", "tests": [{"name": "Lymphocytes", "value": "0.91", "unit": "thou/mm3"}]},
            ]
        }
        keys = [m["key"] for m in dp._metrics_from_structured(structured, 1.0)]
        self.assertEqual(keys, ["Lymphocytes", "Absolute Lymphocytes"])


if __name__ == "__main__":
    unittest.main()
