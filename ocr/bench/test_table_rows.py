"""Checks the table-to-rows mapping the Docling runner relies on.

    python -m unittest bench/test_table_rows.py      (from ocr/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from table_rows import rows_from_table  # noqa: E402


class TestHeaderDetection(unittest.TestCase):
    def test_columns_are_found_by_header_text(self):
        rows = rows_from_table(
            ["Investigation", "Result", "Unit", "Biological Ref. Interval"],
            [["Hemoglobin", "11.3", "g/dL", "12.0 - 15.5"], ["MCHC", "33.1", "g/dL", "32 - 36"]],
        )
        self.assertEqual(
            rows,
            [
                {"key": "Hemoglobin", "value": "11.3", "unit": "g/dL", "reference": "12.0 - 15.5"},
                {"key": "MCHC", "value": "33.1", "unit": "g/dL", "reference": "32 - 36"},
            ],
        )

    def test_reference_is_never_taken_as_the_value(self):
        # Reference column before the result column: position alone would pick the range.
        rows = rows_from_table(
            ["Test Name", "Reference Value", "Observed Value", "Units"],
            [["MCHC", "0.00-20.00", "33.1", "g/dL"]],
        )
        self.assertEqual(rows[0]["value"], "33.1")
        self.assertEqual(rows[0]["reference"], "0.00-20.00")

    def test_header_left_in_the_first_body_row_is_used(self):
        rows = rows_from_table(
            ["0", "1", "2"],
            [["Test", "Result", "Unit"], ["Platelet Count", "2.01", "lakh/cumm"]],
        )
        self.assertEqual(rows, [{"key": "Platelet Count", "value": "2.01", "unit": "lakh/cumm", "reference": None}])

    def test_value_and_unit_in_one_cell_are_split(self):
        rows = rows_from_table(["Parameter", "Result"], [["Bilirubin Total", "1.0 mg/dL"]])
        self.assertEqual(rows[0]["value"], "1.0")
        self.assertEqual(rows[0]["unit"], "mg/dL")

    def test_section_headings_and_blank_rows_are_skipped(self):
        rows = rows_from_table(
            ["Test", "Result", "Unit"],
            [["LIVER FUNCTION TEST", "", ""], ["", "", ""], ["SGPT (ALT)", "16.3", "U/L"]],
        )
        self.assertEqual([r["key"] for r in rows], ["SGPT (ALT)"])


class TestPositionFallback(unittest.TestCase):
    def test_columns_are_inferred_without_a_header(self):
        rows = rows_from_table(
            ["", "", "", ""],
            [
                ["Hemoglobin", "11.3", "g/dL", "12.0-15.5"],
                ["Neutrophils", "82", "%", "40-80"],
                ["Urine Protein", "Negative", "", ""],
            ],
        )
        self.assertEqual(rows[0], {"key": "Hemoglobin", "value": "11.3", "unit": "g/dL", "reference": "12.0-15.5"})
        self.assertEqual(rows[2]["value"], "Negative")

    def test_a_table_with_no_values_gives_nothing(self):
        self.assertEqual(rows_from_table(["Note"], [["Fasting required"], ["Bring ID"]]), [])


if __name__ == "__main__":
    unittest.main()
