"""
Reconstruct structured key-value records from a token stream.

Input:  list[Token] from pdf.py (word-level tokens with coordinates).
Output: nested dict suitable for JSON serialization.

Coordinates carry the structure; this module reads that structure.
Line grouping and field splitting are pure geometry. Classification and
parsing are declarative patterns, easy to extend per template.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Sequence


# ------------------------------------------------------------------
# Primitives
# ------------------------------------------------------------------
@dataclass
class Line:
    y: float
    tokens: list  # list[Token], sorted by x0

    @property
    def text(self) -> str:
        return " ".join(t.text for t in self.tokens).strip()

    @property
    def page(self) -> int:
        return self.tokens[0].page if self.tokens else -1


@dataclass
class Field:
    tokens: list

    @property
    def text(self) -> str:
        return " ".join(t.text for t in self.tokens).strip()

    @property
    def x0(self) -> float:
        return self.tokens[0].x0 if self.tokens else 0.0

    @property
    def x1(self) -> float:
        return self.tokens[-1].x1 if self.tokens else 0.0


# ------------------------------------------------------------------
# Geometry
# ------------------------------------------------------------------
def group_lines(tokens: Sequence, y_tol: float = 3.0) -> list[Line]:
    if not tokens:
        return []

    valid = [
        t for t in tokens
        if t.x1 > t.x0 and t.bottom > t.top and t.text.strip()
    ]
    if not valid:
        return []

    valid.sort(key=lambda t: ((t.top + t.bottom) / 2, t.x0))

    lines: list[Line] = []
    current = [valid[0]]
    current_y = (valid[0].top + valid[0].bottom) / 2

    for t in valid[1:]:
        y = (t.top + t.bottom) / 2
        if abs(y - current_y) <= y_tol:
            current.append(t)
        else:
            current.sort(key=lambda x: x.x0)
            lines.append(Line(y=current_y, tokens=current))
            current = [t]
            current_y = y
    if current:
        current.sort(key=lambda x: x.x0)
        lines.append(Line(y=current_y, tokens=current))

    return lines


def is_table_cell(token) -> bool:
    """True for a token that already represents one whole table cell.

    A ruled table has no whitespace between its columns - the cell bboxes butt
    up against the grid lines - so a pure gap test merges an entire row into
    one field. The extractor already knows where the cell boundaries were, and
    records it in the token source; that beats re-deriving them from geometry.
    """
    return str(getattr(token, "source", "")).endswith("_table")


def split_fields(line: Line, x_gap: float = 15.0) -> list[Field]:
    if not line.tokens:
        return []
    groups: list[list] = [[line.tokens[0]]]
    for t in line.tokens[1:]:
        previous = groups[-1][-1]
        same_field = (
            not is_table_cell(t)
            and not is_table_cell(previous)
            and t.x0 - previous.x1 <= x_gap
        )
        if same_field:
            groups[-1].append(t)
        else:
            groups.append([t])
    return [Field(tokens=g) for g in groups]


# ------------------------------------------------------------------
# Pattern primitives
# ------------------------------------------------------------------
#: One number: digit-grouped ("1,50,000" Indian, "150,000" Western) or plain
#: with an optional decimal part ("13.5", or "13,5" from a decimal-comma locale).
_NUM = r"(?:\d{1,3}(?:,\d{2})*,\d{3}(?:\.\d+)?|\d+(?:[.,]\d+)?)"
_NUMBER_RE = re.compile(
    rf"^[<>≤≥]?\s*[-+]?{_NUM}(?:\s*[-–]\s*{_NUM})?$"
)

#: Abnormal-result markers labs print beside (or glued to) a value. They are
#: exactly the rows a clinician most needs, so they must not break parsing.
_FLAG_WORDS = {"h", "l", "hh", "ll", "high", "low", "abnormal", "critical", "crit"}
_FLAG_SYMBOL_RE = re.compile(r"^(?:\*+|[↑↓]+)$")
#: A value with its flag attached: "11.2 L", "11.2L", "*11.2", "11.2*", "↑11.2".
_FLAGGED_VALUE_RE = re.compile(
    r"^(?P<pre>\*+|[↑↓])?\s*(?P<num>[<>≤≥]?\s*[-+]?" + _NUM + r")\s*"
    r"(?P<post>\*+|[↑↓]|(?i:hh|ll|h|l|high|low|abnormal|critical|crit))?$"
)

#: Non-numeric results that are still a test's answer (urinalysis, serology).
_QUALITATIVE_VALUES = {
    "negative", "positive", "reactive", "non reactive", "non-reactive", "nonreactive",
    "nil", "absent", "present", "trace", "detected", "not detected", "normal",
    "clear", "turbid", "slightly turbid", "hazy", "pale yellow", "yellow",
    "straw", "amber", "dark yellow", "colourless", "colorless",
}
_UNIT_RE = re.compile(r"^[A-Za-z%/µμ^0-9.·×*\[\]]+$")
_REF_RANGE_RE = re.compile(r"\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?")
_REF_COMPARE_RE = re.compile(r"[<>≤≥]\s*\d+(?:\.\d+)?")

_COLUMN_HEADER_WORDS = {
    "test", "name", "results", "result", "units", "unit",
    "bio.", "ref.", "interval", "reference", "range", "value",
    "normal", "observed", "method",
}


def looks_like_number(s: str) -> bool:
    return bool(_NUMBER_RE.match(s.strip()))


def looks_like_unit(s: str) -> bool:
    s = s.strip()
    return bool(s) and len(s) <= 20 and bool(_UNIT_RE.match(s)) and not looks_like_number(s)


def looks_like_reference(s: str) -> bool:
    return bool(_REF_RANGE_RE.search(s) or _REF_COMPARE_RE.search(s))


def is_column_header(line: Line) -> bool:
    words = line.text.lower().split()
    if not words:
        return False
    hits = sum(1 for w in words if w.rstrip(".,:") in _COLUMN_HEADER_WORDS)
    return hits >= 3 and hits / len(words) >= 0.5


def is_noise(line: Line) -> bool:
    text = line.text.strip()
    if len(text) <= 1:
        return True
    if re.fullmatch(r"\d+", text):
        return True
    if re.fullmatch(r"[\W_]+", text):
        return True
    return False


def is_flag(s: str) -> bool:
    s = s.strip()
    return s.lower() in _FLAG_WORDS or bool(_FLAG_SYMBOL_RE.match(s))


def split_value_flag(s: str) -> tuple[str, str | None] | None:
    """("11.2", "L") for "11.2 L"; ("13.5", None) for a bare number; else None."""
    s = s.strip()
    if looks_like_number(s):
        return s, None
    match = _FLAGGED_VALUE_RE.match(s)
    if not match:
        return None
    flag = match.group("pre") or match.group("post")
    return match.group("num").strip(), flag


#: A value with its unit glued on, as OCR reads a tight column: "1.5mg/dL".
_VALUE_UNIT_RE = re.compile(r"^(?P<num>[<>≤≥]?\s*[-+]?" + _NUM + r")\s*(?P<unit>[A-Za-z%µμ/][^\s]*)$")


def split_value_unit(s: str) -> tuple[str, str] | None:
    """("1.5", "mg/dL") for "1.5mg/dL" or "1.5 mg/dL"; None otherwise."""
    match = _VALUE_UNIT_RE.match(s.strip())
    if not match or not looks_like_lab_unit(match.group("unit")):
        return None
    return match.group("num").strip(), match.group("unit")


#: Units short enough to be mistaken for words, accepted on their own; any
#: other unit must carry "/" or "%" ("mg/dL", "x10^3/uL", "%").
_BARE_LAB_UNITS = {"fl", "pg", "g", "mg", "ng", "iu", "u", "sec", "secs", "seconds", "ratio", "mmhg"}


def looks_like_lab_unit(s: str) -> bool:
    s = s.strip()
    # A letter or "%" is required: "/10/2025" is the tail of a date, not a unit.
    if not looks_like_unit(s) or not re.search(r"[A-Za-z%µμ]", s):
        return False
    return "/" in s or "%" in s or s.lower() in _BARE_LAB_UNITS


def looks_like_qualitative(s: str) -> bool:
    return " ".join(s.lower().split()) in _QUALITATIVE_VALUES


def looks_like_value(s: str) -> bool:
    return (
        split_value_flag(s) is not None
        or looks_like_qualitative(s)
        or split_value_unit(s) is not None
    )


_TRAILING_REF_RE = re.compile(
    r"\s+(?P<ref>[<>≤≥]\s*" + _NUM + r"|" + _NUM + r"\s*[-–]\s*" + _NUM + r")$"
)


def parse_inline_test_row(text: str) -> dict | None:
    """Read a test row that OCR returned as one run of text.

    PaddleOCR merges neighbouring columns into one box when the gap between
    them is small - "Hemoglobin 11.2 L g/dL 12.0 - 15.5" arrives as a single
    phrase, so there are no field gaps to split on. The row is read from the
    right, where the shape is fixed: [reference] [unit] [flag] value, and
    whatever precedes the value is the name.

    Only accepted with a lab unit or a reference range present, so header
    lines such as "Age 31 Years" or "Page 1 of 2" are not taken as tests.
    """
    text = " ".join(text.split())
    if ":" in text:
        return None

    reference = None
    match = _TRAILING_REF_RE.search(text)
    if match:
        reference = match.group("ref")
        text = text[: match.start()]

    words = text.split(" ")
    unit = None
    # Glued "92mg/dL" first: it would also pass as a bare unit ("10^3/uL"
    # legitimately starts with digits), leaving no value behind it.
    if len(words) >= 2 and split_value_unit(words[-1]):
        value, unit = split_value_unit(words.pop())
        words.append(value)
    elif len(words) >= 3 and looks_like_lab_unit(words[-1]):
        unit = words.pop()

    flag = None
    if len(words) >= 3 and is_flag(words[-1]):
        flag = words.pop()

    if len(words) < 2:
        return None
    split = split_value_flag(words[-1])
    if split is None:
        return None
    value, glued_flag = split
    flag = flag or glued_flag
    name = " ".join(words[:-1])

    if unit is None and reference is None:
        return None
    if not re.search(r"[A-Za-z]", name) or re.search(r"[-–]$", name):
        return None
    return {"name": name, "value": value, "unit": unit, "reference": reference, "flag": flag}


def _is_ocr_line(line: Line) -> bool:
    """True when every token came from PaddleOCR rather than a PDF text layer."""
    return all(str(getattr(t, "source", "")) == "paddleocr" for t in line.tokens)


#: A serial-number cell ("1", "12", "3.") in front of the test name.
_SERIAL_RE = re.compile(r"^\d{1,3}\.?$")


def _drop_serial_column(fields: list[Field]) -> list[Field]:
    if (
        len(fields) >= 3
        and _SERIAL_RE.match(fields[0].text.strip())
        and not looks_like_value(fields[1].text)
        and looks_like_value(fields[2].text)
    ):
        return fields[1:]
    return fields


def is_test_row(fields: list[Field]) -> bool:
    fields = _drop_serial_column(fields)
    if len(fields) < 2 or len(fields) > 7:
        return False
    if looks_like_number(fields[0].text):
        return False
    if not looks_like_value(fields[1].text):
        return False
    return True


#: A line that is nothing but a parenthesized phrase - "(Hexokinase,CLIA,RIA)"
#: - is the analytical method for the section above it, not a new section.
#: Without this every panel heading is immediately overwritten by its own
#: method line, and the tests end up filed under the method.
_METHOD_ONLY_RE = re.compile(r"^\([^()]*\)$")


def is_method_annotation(text: str) -> bool:
    return bool(_METHOD_ONLY_RE.match(text.strip()))


def is_section_title(fields: list[Field]) -> bool:
    if len(fields) != 1:
        return False
    text = fields[0].text
    if not text or looks_like_number(text):
        return False
    if is_method_annotation(text):
        return False
    # "Collected: 12/10/2025" is a header field that happens to be long, not a
    # section heading. Without this, every key-value line over the length
    # threshold is swallowed before parse_kv ever sees it.
    if parse_kv(fields) is not None:
        return False
    return len(text) > 15


# ------------------------------------------------------------------
# Parsers
# ------------------------------------------------------------------
def _is_known_label(text: str) -> bool:
    """True when `text` is a header label this module recognizes."""
    squashed = re.sub(r"[^a-z0-9]", "", text.strip().lower())
    return bool(squashed) and squashed in _SQUASHED_HEADER_KEY_MAP


def parse_kv_pairs(fields: list[Field]) -> list[tuple[str, str]]:
    """Split a header line into every `label : value` pair it carries.

    Lab headers are laid out in two columns, so one visual line holds two
    records: ``Lab No. : 196404930   Age : 23 Years``. Treating the first
    colon as the only separator buries the second label inside the first
    value, which is how age and gender went missing entirely.

    A colon only starts a new pair when the words before it are a *known*
    header label. That keeps clock times (``12:01:00PM``) and prose colons
    from being mistaken for column boundaries, and means an unrecognized
    layout degrades to the old single-pair behaviour rather than splitting
    somewhere arbitrary.
    """
    text = " ".join(f.text for f in fields).strip()
    if ":" not in text:
        return []

    words = text.split()

    # Word index -> the label ending at that word, for every colon boundary.
    boundaries: list[tuple[int, int, str]] = []  # (label_start, label_end, label)
    for i, word in enumerate(words):
        if ":" not in word:
            continue
        # The colon may be glued to the label ("Name:") or stand alone (":").
        head, _, _ = word.partition(":")
        candidates = []
        if head:
            candidates.append((i, i + 1, head))
        # Look back up to 3 words for a multi-word label ("Report Status :").
        for back in range(1, 4):
            start = i - back if head else i - back + 1
            if start < 0:
                continue
            end = i + 1 if head else i
            if end <= start:
                continue
            label = " ".join(words[start:end]).rstrip(":")
            candidates.append((start, end, label))

        for start, end, label in candidates:
            if _is_known_label(label):
                boundaries.append((start, end, label))
                break

    if not boundaries:
        # Nothing recognized: fall back to "first colon wins", as before.
        before, _, after = text.partition(":")
        label = before.strip()
        return [(label, after.strip())] if label else []

    pairs: list[tuple[str, str]] = []
    for idx, (start, end, label) in enumerate(boundaries):
        value_start = end
        value_end = boundaries[idx + 1][0] if idx + 1 < len(boundaries) else len(words)
        value = " ".join(words[value_start:value_end]).lstrip(":").strip()
        pairs.append((label, value))
    return pairs


def parse_kv(fields: list[Field]) -> tuple[str, str] | None:
    """First `label : value` pair on the line, or None.

    Kept for callers that only need to know whether a line is a key-value
    line at all; `parse_kv_pairs` is what the document walker uses.
    """
    pairs = parse_kv_pairs(fields)
    return pairs[0] if pairs else None


def parse_test_row(fields: list[Field]) -> dict | None:
    if not is_test_row(fields):
        return None
    fields = _drop_serial_column(fields)

    name = fields[0].text
    value = fields[1].text.strip()
    flag = None
    unit = None
    reference = None
    split = split_value_flag(value)
    if split is not None:
        value, flag = split
    elif split_value_unit(value) is not None:
        value, unit = split_value_unit(value)

    for f in fields[2:]:
        text = f.text.strip()
        if not text:
            continue
        # Checked before units: a lone "H"/"L" also passes the unit pattern.
        if flag is None and is_flag(text):
            flag = text
        elif reference is None and looks_like_reference(text):
            reference = text
        elif unit is None and looks_like_unit(text):
            unit = text
        elif reference is None:
            reference = text

    return {"name": name, "value": value, "unit": unit, "reference": reference, "flag": flag}


# ------------------------------------------------------------------
# Header key normalization
# ------------------------------------------------------------------
_HEADER_KEY_MAP = {
    "name": "name",
    "patient name": "name",
    "lab no": "lab_no",
    "lab no.": "lab_no",
    "lab number": "lab_no",
    "ref by": "referred_by",
    "referred by": "referred_by",
    "collected": "collected_at",
    "collected at": "collection_center",
    "a/c status": "account_status",
    "account status": "account_status",
    "age": "age",
    "gender": "gender",
    "sex": "gender",
    "reported": "reported_at",
    "report status": "report_status",
    "processed at": "processed_at",
    "sample type": "sample_type",
    "specimen": "sample_type",
}

_PATIENT_KEYS = {"name", "age", "gender", "lab_no"}


#: The same map keyed on alphanumerics only. OCR routinely eats the spaces in
#: a header label ("Lab No.:" -> "LabNo.:"), which would otherwise miss every
#: exact lookup and leave the field under a junk key. This mirrors how
#: standardizeLabReport.service.js normalizes raw keys on the Node side.
_SQUASHED_HEADER_KEY_MAP = {
    re.sub(r"[^a-z0-9]", "", label): standard
    for label, standard in _HEADER_KEY_MAP.items()
}


def normalize_key(key: str) -> str:
    k = key.strip().lower().rstrip(":").strip()
    if k in _HEADER_KEY_MAP:
        return _HEADER_KEY_MAP[k]
    squashed = re.sub(r"[^a-z0-9]", "", k)
    if squashed in _SQUASHED_HEADER_KEY_MAP:
        return _SQUASHED_HEADER_KEY_MAP[squashed]
    return re.sub(r"[^a-z0-9]+", "_", k).strip("_")


# ------------------------------------------------------------------
# Top-level
# ------------------------------------------------------------------
def _parse_row(line: Line, fields: list[Field]) -> dict | None:
    """A test row from the line's fields, or from its text if OCR merged them."""
    test = parse_test_row(fields)
    if test is None and _is_ocr_line(line):
        test = parse_inline_test_row(line.text)
    return test


def structure_document(
    tokens: Sequence,
    y_tol: float = 3.0,
    x_gap: float = 15.0,
) -> dict:
    lines = group_lines(tokens, y_tol=y_tol)

    by_page: dict[int, list[Line]] = defaultdict(list)
    for line in lines:
        by_page[line.page].append(line)

    patient: dict[str, str] = {}
    meta: dict[str, str] = {}
    sections: list[dict] = []
    notes: list[str] = []
    comments: list[str] = []

    current_section: dict | None = None
    mode = "body"  # "body" | "notes" | "comments"

    for page_idx in sorted(by_page.keys()):
        # A "Note:" block belongs to the page it is printed on; carrying the
        # mode across the page break files every later test as a note.
        mode = "body"
        for line in by_page[page_idx]:
            if is_noise(line):
                continue

            text = line.text
            lower = text.lower()

            if lower.rstrip(":").strip() in {"note", "notes"}:
                mode = "notes"
                continue
            if lower.rstrip(":").strip() in {"comment", "comments"}:
                mode = "comments"
                continue
            if lower.rstrip(":").strip() in {"interpretation", "interpretations"}:
                mode = "body"
                continue
            if lower == "test report":
                mode = "body"
                continue

            if mode in ("notes", "comments"):
                # A test row means the note ended and the table resumed.
                if _parse_row(line, split_fields(line, x_gap=x_gap)) is not None:
                    mode = "body"
                else:
                    (notes if mode == "notes" else comments).append(text)
                    continue

            if is_column_header(line):
                continue

            fields = split_fields(line, x_gap=x_gap)
            if not fields:
                continue

            test = _parse_row(line, fields)
            if test:
                if current_section is None:
                    current_section = {"title": None, "method": None, "tests": []}
                    sections.append(current_section)
                current_section["tests"].append(test)
                continue

            if len(fields) == 1 and is_method_annotation(fields[0].text):
                if current_section is not None:
                    current_section["method"] = fields[0].text.strip()
                continue

            if is_section_title(fields):
                current_section = {"title": fields[0].text, "method": None, "tests": []}
                sections.append(current_section)
                continue

            for key, value in parse_kv_pairs(fields):
                norm = normalize_key(key)
                if norm in _PATIENT_KEYS:
                    patient[norm] = value
                else:
                    meta[norm] = value

    return {
        "patient": patient,
        "report_meta": meta,
        "sections": sections,
        "notes": notes,
        "comments": comments,
    }


def to_json(structured: dict, indent: int = 2) -> str:
    return json.dumps(structured, indent=indent, ensure_ascii=False)
