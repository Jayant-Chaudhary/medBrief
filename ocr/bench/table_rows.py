"""Turn a lab-report table (header + cell rows) into test / value / unit rows.

Kept free of Docling imports so it can be unit-tested in the normal Paddle
environment. The reference column is identified and kept apart: taking the
range as the value is exactly the failure the benchmark is looking for.
"""
from __future__ import annotations

import re

ROLE_PATTERNS = {
    "name": re.compile(r"\b(test|investigation|parameter|examination|description|analyte|component|name)\b", re.I),
    "value": re.compile(r"\b(result|value|observed|finding|reading)s?\b", re.I),
    "unit": re.compile(r"\bunits?\b", re.I),
    "reference": re.compile(r"\b(reference|range|interval|normal|biological|ref\.?)\b", re.I),
}
NUMBER = re.compile(r"^[<>≤≥]?\s*[-+]?\d[\d,]*(\.\d+)?$")
RANGE = re.compile(r"^\s*[<>≤≥]?\s*\d[\d,.]*\s*[-–]\s*\d[\d,.]*\s*$")
# "11.3 g/dL" or "11.3 H g/dL" in one cell: value, optional flag, unit.
VALUE_WITH_UNIT = re.compile(r"^([<>≤≥]?\s*[-+]?\d[\d,]*(?:\.\d+)?)\s*(?:[HLhl*]\s+)?([^\d\s].*)$")
QUALITATIVE = re.compile(
    r"^(negative|positive|nil|absent|present|trace|normal|reactive|non[- ]?reactive|not detected|detected|"
    r"[1-4]\+|\++|(pale |light |dark )?yellow|straw|amber|clear|turbid|hazy|cloudy|occasional|few|many)$",
    re.I,
)


def _clean(cell) -> str:
    return re.sub(r"\s+", " ", str(cell if cell is not None else "")).strip()


def _roles_from_header(header: list[str]) -> dict[str, int]:
    roles: dict[str, int] = {}
    for index, text in enumerate(header):
        for role, pattern in ROLE_PATTERNS.items():
            # A header like "Reference Value" is a reference column, not a value one.
            if role == "value" and ROLE_PATTERNS["reference"].search(text):
                continue
            if role not in roles and pattern.search(text):
                roles[role] = index
                break
    return roles if "name" in roles and "value" in roles else {}


def _looks_like_value(text: str) -> bool:
    return bool(NUMBER.match(text) or QUALITATIVE.match(text) or VALUE_WITH_UNIT.match(text))


def _roles_by_position(rows: list[list[str]]) -> dict[str, int]:
    """No usable header: name = first mostly-text column, value = first mostly-value column after it."""
    if not rows:
        return {}
    width = max(len(r) for r in rows)

    def share(col, test):
        cells = [r[col] for r in rows if col < len(r) and r[col]]
        return sum(1 for c in cells if test(c)) / len(cells) if cells else 0.0

    name = next((c for c in range(width) if share(c, lambda t: not _looks_like_value(t)) >= 0.6), None)
    if name is None:
        return {}
    roles = {"name": name}
    for col in range(name + 1, width):
        if "value" not in roles and share(col, lambda t: _looks_like_value(t) and not RANGE.match(t)) >= 0.5:
            roles["value"] = col
        elif "reference" not in roles and share(col, lambda t: bool(RANGE.match(t))) >= 0.5:
            roles["reference"] = col
        elif "value" in roles and "unit" not in roles and share(col, lambda t: len(t) <= 12 and not NUMBER.match(t)) >= 0.5:
            roles["unit"] = col
    return roles if "value" in roles else {}


def rows_from_table(header: list, rows: list[list]) -> list[dict]:
    """Rows of {key, value, unit, reference}; section headings and blanks are skipped."""
    header = [_clean(h) for h in header]
    rows = [[_clean(c) for c in r] for r in rows]

    roles = _roles_from_header(header)
    # Docling sometimes leaves the real header as the first body row.
    if not roles and rows:
        roles = _roles_from_header(rows[0])
        if roles:
            rows = rows[1:]
    if not roles:
        roles = _roles_by_position(rows)
    if not roles:
        return []

    def cell(row, role):
        index = roles.get(role)
        return row[index] if index is not None and index < len(row) else ""

    out = []
    for row in rows:
        name, value = cell(row, "name"), cell(row, "value")
        if not name or not value or name.lower() == value.lower():
            continue
        unit = cell(row, "unit")
        combined = VALUE_WITH_UNIT.match(value)
        if combined and not unit and not RANGE.match(value):
            value, unit = combined.group(1).strip(), combined.group(2).strip()
        out.append({"key": name, "value": value, "unit": unit or None, "reference": cell(row, "reference") or None})
    return out
