"""
Single entry point for document extraction.

This module is the *router*: it owns no extraction logic of its own, it only
decides which engine should see a file, intercepts that engine when it reports
it cannot do the job, and flattens whatever comes back into one envelope the
Express backend can rely on.

Routing
-------
    image (png/jpg/jpeg) ─────────────────────────────► PaddleOCR engine
    pdf ──► digital engine ──► status ok / partial ───► digital result
                            └► scanned / garbled /
                               error / no tokens ─────► PaddleOCR engine

The digital engine already distinguishes "this page has no text" from "this
extractor failed" (`DocumentResult.status`), so the fallback here is a
translation of that verdict, not a second guess at it.

Contracts
---------
`process_document()` never raises. Every failure path - unreadable file,
unsupported type, missing GPU stack, engine crash - comes back as the same
dict shape with ``status="failed"`` and a populated ``error`` field, because
the caller is an HTTP handler that must not 500 on a bad upload.

`to_ingest_payload()` reshapes that envelope into the exact body
``POST /lab-reports`` validates against (``ocrPayloadSchema`` in
server/src/validators/labReports.validators.js), so the Node side needs no
translation layer of its own.

Engine imports are deferred to first use. `paddle`/`paddleocr` pull in a CUDA
runtime and `pdfplumber` is not cheap either; importing this module must stay
free so the backend can load it at startup on a box where only one of the two
stacks is installed.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Literal, Sequence

# structure_parser is pure stdlib - safe to import eagerly, and the OCR branch
# needs it to turn flat text back into fields.
from structure_parser import group_lines, structure_document

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Policy
# --------------------------------------------------------------------------
Status = Literal["success", "partial", "failed"]
Engine = Literal["digital", "ocr", "none"]
DetectedType = Literal["pdf", "image", "unsupported"]

#: Extensions routed straight to OCR. Adding a format (tiff, bmp, webp - all
#: of which PaddleOCR reads) is a one-line change here and nowhere else.
IMAGE_EXTENSIONS: frozenset[str] = frozenset({".png", ".jpg", ".jpeg"})
PDF_EXTENSIONS: frozenset[str] = frozenset({".pdf"})

#: Digital-engine verdicts that mean "I cannot read this, send it to OCR".
#: `garbled` is included deliberately: a PDF with broken font encodings yields
#: text that is worse than useless downstream, and rasterising it is the fix.
OCR_FALLBACK_STATUSES: frozenset[str] = frozenset({"scanned", "garbled", "error"})

#: Digital verdicts that are usable but degraded.
DEGRADED_STATUSES: frozenset[str] = frozenset({"partial"})

#: Below this mean OCR confidence the report is flagged `partial`, which makes
#: the Node triage service raise the "bring the physical report" checklist item.
OCR_PARTIAL_CONFIDENCE = 0.85

#: Guard against a caller handing us a 2GB "PDF". Generous on purpose.
MAX_FILE_BYTES = 64 * 1024 * 1024

#: Synthetic geometry for OCR text (see `_tokens_from_ocr`).
_CHAR_WIDTH = 10.0
_LINE_HEIGHT = 20.0
#: Pages are pushed far apart on the y axis so that line grouping, which sorts
#: globally by y, can never merge page 1 line 0 with page 2 line 0.
_PAGE_Y_STRIDE = 1_000_000.0

_PDF_MAGIC = b"%PDF"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_JPEG_MAGIC = b"\xff\xd8\xff"


# --------------------------------------------------------------------------
# Deferred engine imports
# --------------------------------------------------------------------------
def _load_digital_engine():
    """Import the digital engine on first use. Raises ImportError upward."""
    import digital_extractor  # noqa: PLC0415 - deliberate lazy import

    return digital_extractor


def _load_ocr_engine():
    """Import the PaddleOCR engine on first use. Raises ImportError upward."""
    import ocr_extractor  # noqa: PLC0415 - deliberate lazy import

    return ocr_extractor


_gpu_checked = False


def _verify_gpu_once(engine) -> None:
    """Log the CUDA verdict once per process instead of once per document."""
    global _gpu_checked
    if _gpu_checked:
        return
    _gpu_checked = True
    try:
        engine.verify_gpu_status()
    except Exception as exc:  # pragma: no cover - diagnostics only
        logger.warning("GPU status check failed: %s", exc)


# --------------------------------------------------------------------------
# File-type detection
# --------------------------------------------------------------------------
def sniff_magic(file_path: str | Path) -> DetectedType | None:
    """Identify a file by its leading bytes, or None if inconclusive.

    Trusted over the extension: uploads arrive from phone cameras and web
    forms that routinely mislabel a JPEG as `.png` or a PDF as `.jpg`.
    """
    try:
        with open(file_path, "rb") as fh:
            head = fh.read(1024)
    except OSError as exc:
        logger.warning("Could not read header of %s: %s", file_path, exc)
        return None

    if not head:
        return None
    # Image signatures sit at offset 0 and are unambiguous, so they are checked
    # first: a JPEG whose EXIF happens to contain "%PDF" is still a JPEG.
    if head.startswith(_PNG_MAGIC) or head.startswith(_JPEG_MAGIC):
        return "image"
    # Some scanners emit junk before the PDF header; the spec tolerates it.
    if _PDF_MAGIC in head:
        return "pdf"
    return None


def detect_file_type(file_path: str | Path) -> tuple[DetectedType, list[str]]:
    """Return (type, warnings). Magic bytes win; the extension is the fallback."""
    warnings: list[str] = []
    ext = Path(file_path).suffix.lower()

    if ext in PDF_EXTENSIONS:
        by_ext: DetectedType = "pdf"
    elif ext in IMAGE_EXTENSIONS:
        by_ext = "image"
    else:
        by_ext = "unsupported"

    sniffed = sniff_magic(file_path)
    if sniffed is None:
        return by_ext, warnings

    if by_ext == "unsupported":
        warnings.append(
            f"extension '{ext or '(none)'}' is not supported but content is {sniffed}; "
            f"routing as {sniffed}"
        )
    elif sniffed != by_ext:
        warnings.append(
            f"extension '{ext}' disagrees with file content ({sniffed}); trusting content"
        )
    return sniffed, warnings


# --------------------------------------------------------------------------
# Token adapters
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class _OcrToken:
    """Duck-typed stand-in for digital_extractor.Token.

    structure_parser only reads .text/.x0/.top/.x1/.bottom/.page, so OCR lines
    can be given synthetic coordinates and fed through the same structuring
    code as native PDF words. The x axis is character offsets scaled by
    `_CHAR_WIDTH`, which preserves the one thing OCR text still carries:
    runs of whitespace that mark column boundaries.
    """

    text: str
    x0: float
    top: float
    x1: float
    bottom: float
    page: int
    conf: float = 1.0
    source: str = "paddleocr"


def _tokens_from_ocr_geometry(payload: dict) -> tuple[list[_OcrToken], dict]:
    """Tokens from real detection boxes, one token per recognized box.

    PaddleOCR already groups words into phrase boxes, so a box is usually a
    whole cell; keeping that grouping is better than re-deriving it. Tolerances
    are scaled from the median box height because OCR coordinates are in image
    pixels, where the point-based defaults are meaninglessly small.
    """
    tokens: list[_OcrToken] = []
    heights: list[float] = []

    for page in payload.get("pages", []) or []:
        page_index = int(page.get("page_number", 1)) - 1
        page_base = page_index * _PAGE_Y_STRIDE
        for item in page.get("items", []) or []:
            bbox = item.get("bbox")
            text = (item.get("text") or "").strip()
            if not bbox or not text:
                continue
            x0, top, x1, bottom = (float(v) for v in bbox)
            if x1 <= x0 or bottom <= top:
                continue
            heights.append(bottom - top)
            tokens.append(
                _OcrToken(
                    text=text,
                    x0=x0,
                    top=page_base + top,
                    x1=x1,
                    bottom=page_base + bottom,
                    page=page_index,
                    conf=float(item.get("confidence") or 0.0),
                )
            )

    if not heights:
        return [], {}

    heights.sort()
    median_height = heights[len(heights) // 2] or 1.0
    # Half a line height groups a row; a full line height separates columns
    # while still joining words the detector split inside one phrase.
    return tokens, {"y_tol": max(1.0, median_height * 0.5),
                    "x_gap": max(1.0, median_height * 1.0)}


def _tokens_from_ocr_text(payload: dict) -> tuple[list[_OcrToken], dict]:
    """Fallback for payloads with no geometry: lay the text out on a grid.

    Character offsets scaled by `_CHAR_WIDTH` preserve the one structural
    signal bare text still carries - runs of whitespace marking columns.
    """
    tokens: list[_OcrToken] = []
    for page in payload.get("pages", []) or []:
        page_index = int(page.get("page_number", 1)) - 1
        page_conf = float(page.get("avg_confidence") or 0.0)
        page_base = page_index * _PAGE_Y_STRIDE
        for line_index, line in enumerate(page.get("lines", []) or []):
            top = page_base + line_index * _LINE_HEIGHT
            bottom = top + _LINE_HEIGHT * 0.7
            for match in re.finditer(r"\S+", line):
                tokens.append(
                    _OcrToken(
                        text=match.group(),
                        x0=match.start() * _CHAR_WIDTH,
                        top=top,
                        x1=match.end() * _CHAR_WIDTH,
                        bottom=bottom,
                        page=page_index,
                        conf=page_conf,
                    )
                )
    return tokens, {"y_tol": 3.0, "x_gap": 15.0}


def _tokens_from_ocr(payload: dict) -> tuple[list[_OcrToken], dict, bool]:
    """Prefer real detection geometry; fall back to laying the text out.

    Returns (tokens, layout tolerances, whether real geometry was used).
    """
    tokens, layout = _tokens_from_ocr_geometry(payload)
    if tokens:
        return tokens, layout, True
    tokens, layout = _tokens_from_ocr_text(payload)
    return tokens, layout, False


def _separate_pages(tokens: Sequence) -> list:
    """Offset each page's y coordinates so line grouping cannot span pages.

    `structure_parser.group_lines` sorts the whole token stream by y before it
    groups, so a line at y=90 on page 1 and a line at y=90 on page 2 land in
    the same Line, which then reports whichever page came first. Spreading the
    pages apart on the y axis removes the collision without touching the
    engine's own logic.
    """
    out = []
    for token in tokens:
        try:
            offset = token.page * _PAGE_Y_STRIDE
            out.append(
                replace(token, top=token.top + offset, bottom=token.bottom + offset)
            )
        except Exception:  # not a dataclass - leave it alone
            return list(tokens)
    return out


def _pages_from_tokens(tokens: Sequence, confidence: float | None) -> list[dict]:
    """Rebuild per-page plain text from a token stream, page by page."""
    by_page: dict[int, list] = defaultdict(list)
    for token in tokens:
        by_page[token.page].append(token)

    pages: list[dict] = []
    for page_index in sorted(by_page):
        lines = group_lines(by_page[page_index])
        pages.append(
            {
                "page_number": page_index + 1,
                "line_count": len(lines),
                "confidence": confidence,
                "text": "\n".join(line.text for line in lines),
            }
        )
    return pages


# --------------------------------------------------------------------------
# Report-level derivations
# --------------------------------------------------------------------------
#: Day-first before month-first: the reports this serves are printed in India,
#: where 05/10/2025 is 5 October. A month-first date is only reached when the
#: day-first reading is impossible (10/25/2025).
_DATE_PATTERNS: tuple[str, ...] = (
    "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d.%m.%Y", "%Y/%m/%d",
    "%d/%m/%y", "%d-%m-%y", "%d.%m.%y",
    "%d %b %Y", "%d %B %Y", "%d-%b-%Y", "%d-%B-%Y", "%d/%b/%Y", "%d/%B/%Y",
    "%d %b %y", "%d-%b-%y", "%d/%b/%y",
    "%b %d, %Y", "%B %d, %Y",
    "%m/%d/%Y", "%m-%d-%Y",
)

#: report_meta keys that may carry the date printed on the report, best first.
_REPORT_DATE_KEYS: tuple[str, ...] = (
    "collected_at", "collected", "reported_at", "reported",
    "sample_collected", "report_date", "date",
)


def _parse_report_date(structured: dict) -> str | None:
    """Best-effort ISO date for `lab_reports.report_date`, or None."""
    meta = structured.get("report_meta") or {}
    for key in _REPORT_DATE_KEYS:
        raw = meta.get(key)
        if not raw:
            continue
        match = re.search(
            r"\d{1,4}[/\-. ][A-Za-z0-9]{1,9}[/\-. ]\d{2,4}|[A-Za-z]+ \d{1,2}, \d{4}",
            str(raw),
        )
        if not match:
            continue
        candidate = match.group().strip()
        for pattern in _DATE_PATTERNS:
            try:
                return datetime.strptime(candidate, pattern).date().isoformat()
            except ValueError:
                continue
    return None


#: Differential white-cell types. Under an "Absolute ... Count" heading labs
#: print them bare ("Neutrophils 6.97 thou/mm3"), which reads as the
#: percentage test of the same name.
_WBC_TYPES_RE = re.compile(r"^(segmented\s+)?(neutrophils?|lymphocytes?|monocytes?|eosinophils?|basophils?)$", re.I)
_ABSOLUTE_HEADING_RE = re.compile(r"\babsolute\b", re.I)


def _qualified_name(name: str, section_title: str | None) -> str:
    """"Neutrophils" under "Absolute Leucocyte Count" -> "Absolute Neutrophils"."""
    if section_title and _ABSOLUTE_HEADING_RE.search(section_title) and _WBC_TYPES_RE.match(name):
        return f"Absolute {name}"
    return name


def _normalized_box(box, page: int, page_sizes: dict[int, tuple[float, float]]) -> list[float] | None:
    """A token-coordinate box as fractions of its page: [x0, y0, x1, y1] in 0..1.

    Tokens were pushed down by `page * _PAGE_Y_STRIDE` so pages could not merge
    during line grouping; that offset comes off first. Dividing by the page's
    own size makes the result independent of the reader (PDF points or OCR
    pixels) and of whatever size the page is later drawn at. Without a known
    page size there is no honest answer, so None.
    """
    size = page_sizes.get(page)
    if not box or not size or not size[0] or not size[1]:
        return None
    width, height = size
    offset = page * _PAGE_Y_STRIDE
    x0, top, x1, bottom = box
    if top >= offset:
        top, bottom = top - offset, bottom - offset

    def clamp(v: float) -> float:
        return round(min(1.0, max(0.0, v)), 5)

    out = [clamp(x0 / width), clamp(top / height), clamp(x1 / width), clamp(bottom / height)]
    return out if out[2] > out[0] and out[3] > out[1] else None


def _source_of(test: dict, page_sizes: dict[int, tuple[float, float]] | None) -> dict | None:
    """Where a test row was printed: {page (1-based), row, value} as page fractions."""
    location = test.get("location") or {}
    if not page_sizes or not location:
        return None
    page = int(location.get("page") or 0)
    row = _normalized_box(location.get("row"), page, page_sizes)
    if row is None:
        return None
    return {"page": page + 1, "row": row, "value": _normalized_box(location.get("value"), page, page_sizes)}


def _metrics_from_structured(
    structured: dict,
    confidence: float | None,
    page_sizes: dict[int, tuple[float, float]] | None = None,
) -> list[dict]:
    """Flatten parsed test rows into the metric shape the backend ingests.

    Keys stay as printed on the report ("HGB", "Hb"); mapping them to
    `metric_dictionary.standard_key` is the Node standardization service's job,
    not ours. The one exception is a bare white-cell name under an "Absolute"
    heading, which is qualified so it isn't read as the percentage test.
    """
    metrics: list[dict] = []
    for section in structured.get("sections", []) or []:
        title = section.get("title")
        for test in section.get("tests", []) or []:
            name = _qualified_name((test.get("name") or "").strip(), title)
            value = test.get("value")
            if not name or value in (None, ""):
                continue
            metrics.append(
                {
                    "key": name,
                    "value": str(value).strip(),
                    "unit": test.get("unit"),
                    "reference": test.get("reference"),
                    "flag": test.get("flag"),
                    "section": title,
                    "confidence": confidence,
                    "source": _source_of(test, page_sizes),
                }
            )
    return metrics


# --------------------------------------------------------------------------
# Envelope
# --------------------------------------------------------------------------
def _envelope(file_path: str | Path, detected_type: DetectedType = "unsupported") -> dict:
    path = Path(file_path)
    try:
        size = path.stat().st_size
    except OSError:
        size = None

    return {
        "status": "failed",
        "engine": "none",
        "file": {
            "name": path.name,
            "path": str(path.resolve()) if path.exists() else str(path),
            "extension": path.suffix.lower(),
            "size_bytes": size,
            "detected_type": detected_type,
        },
        "page_count": 0,
        "text": "",
        "pages": [],
        "structured": {
            "patient": {},
            "report_meta": {},
            "sections": [],
            "notes": [],
            "comments": [],
        },
        "metrics": [],
        "tables": [],
        "report_date": None,
        "confidence": None,
        "routing": {
            "detected_type": detected_type,
            "attempts": [],
            "fallback": False,
            "fallback_reason": None,
        },
        "diagnostics": {},
        "warnings": [],
        "error": None,
        "processing_time_seconds": 0.0,
    }


def _finalize(envelope: dict, started_at: float) -> dict:
    # Text with no recognizable test rows is not a successful lab-report read:
    # it is a photo of something else, or a layout the parser does not know.
    # `partial` routes it to a clinician instead of silently showing nothing.
    if envelope["status"] == "success" and not envelope["metrics"]:
        envelope["status"] = "partial"
        envelope["warnings"].append("no test results were recognized in the document")
    envelope["processing_time_seconds"] = round(time.time() - started_at, 3)
    return envelope


def _retry_digital_with_ocr(envelope: dict, target: str, min_confidence: float) -> dict:
    """OCR a digital PDF that yielded no metrics; keep the better envelope."""
    reason = "digital engine found no test results"
    envelope["routing"]["attempts"].append({"engine": "ocr", "reason": reason})
    try:
        payload = _run_ocr(target, min_confidence)
    except Exception as exc:
        logger.warning("OCR retry of digital PDF %s failed: %s", target, exc)
        envelope["warnings"].append(f"OCR retry failed: {exc}")
        return envelope

    ocr_envelope = _fill_from_ocr(
        {**envelope, "warnings": list(envelope["warnings"]),
         "diagnostics": dict(envelope["diagnostics"]),
         "routing": {**envelope["routing"], "fallback": True, "fallback_reason": reason}},
        payload,
    )
    if len(ocr_envelope["metrics"]) > len(envelope["metrics"]):
        return ocr_envelope
    return envelope


# --------------------------------------------------------------------------
# Engine branches
# --------------------------------------------------------------------------
def _run_digital(file_path: str, config=None) -> Any:
    engine = _load_digital_engine()
    if config is None:
        return engine.process_digital_pdf(file_path)
    return engine.process_digital_pdf(file_path, config)


def _needs_ocr_fallback(result) -> str | None:
    """Return the reason this digital result must be re-run through OCR."""
    status = getattr(result, "status", "error")
    if status in OCR_FALLBACK_STATUSES:
        detail = getattr(result, "error", None)
        return f"digital engine returned status '{status}'" + (f": {detail}" if detail else "")
    if not getattr(result, "tokens", None):
        return "digital engine returned no tokens"
    return None


def _fill_from_digital(envelope: dict, result, separate_pages: bool) -> dict:
    tokens = list(getattr(result, "tokens", []) or [])
    if separate_pages:
        tokens = _separate_pages(tokens)

    structured = structure_document(tokens)
    pages = _pages_from_tokens(tokens, confidence=1.0)

    envelope["engine"] = "digital"
    envelope["structured"] = structured
    envelope["pages"] = pages
    envelope["page_count"] = getattr(result, "pages_processed", len(pages))
    envelope["text"] = "\n\n".join(page["text"] for page in pages if page["text"])
    envelope["tables"] = list(getattr(result, "tables", []) or [])
    # Native text is exact; there is no per-glyph confidence to average.
    envelope["confidence"] = 1.0 if tokens else None
    page_sizes = {
        page.index: (page.width, page.height)
        for page in getattr(result, "pages", []) or []
        if getattr(page, "width", None) and getattr(page, "height", None)
    }
    envelope["metrics"] = _metrics_from_structured(structured, envelope["confidence"], page_sizes)
    envelope["report_date"] = _parse_report_date(structured)

    summary = result.summary() if hasattr(result, "summary") else {}
    envelope["diagnostics"] = {"digital": summary}

    digital_status = getattr(result, "status", "error")
    if not tokens:
        envelope["status"] = "failed"
        envelope["error"] = envelope["error"] or "digital engine produced no text"
    elif digital_status in DEGRADED_STATUSES:
        envelope["status"] = "partial"
        envelope["warnings"].append(
            f"digital engine reported garbled pages: {getattr(result, 'garbled_pages', [])}"
        )
    else:
        envelope["status"] = "success"
    return envelope


def _run_ocr(file_path: str, min_confidence: float) -> dict:
    engine = _load_ocr_engine()
    _verify_gpu_once(engine)
    return engine.extract_and_format_pdf_gpu(file_path, min_confidence=min_confidence)


def _ocr_page_text(page: dict) -> str:
    """Page text, derived from `lines` when the engine's `text` field is empty.

    `text` is a convenience duplicate of `lines` in the OCR payload; treating it
    as the source of truth means one missing field turns a good extraction into
    a reported failure.
    """
    text = (page.get("text") or "").strip()
    if text:
        return page["text"]
    return "\n".join(page.get("lines", []) or [])


def _fill_from_ocr(envelope: dict, payload: dict) -> dict:
    pages = [
        {
            "page_number": page.get("page_number"),
            "line_count": page.get("line_count", len(page.get("lines", []) or [])),
            "confidence": page.get("avg_confidence"),
            "text": _ocr_page_text(page),
        }
        for page in payload.get("pages", []) or []
    ]
    tokens, layout, has_geometry = _tokens_from_ocr(payload)
    structured = structure_document(tokens, **layout) if tokens else structure_document([])
    confidence = payload.get("overall_avg_confidence") or None

    envelope["engine"] = "ocr"
    envelope["pages"] = pages
    envelope["page_count"] = payload.get("total_pages", len(pages))
    envelope["text"] = "\n\n".join(page["text"] for page in pages if page["text"])
    envelope["structured"] = structured
    envelope["confidence"] = confidence
    # Positions only from real detection boxes; the text-only fallback lays
    # lines out on an invented grid that says nothing about the page.
    page_sizes = (
        {
            int(page.get("page_number", 1)) - 1: (page.get("width"), page.get("height"))
            for page in payload.get("pages", []) or []
            if page.get("width") and page.get("height")
        }
        if has_geometry
        else {}
    )
    envelope["metrics"] = _metrics_from_structured(structured, confidence, page_sizes)
    envelope["report_date"] = _parse_report_date(structured)
    envelope["diagnostics"]["ocr"] = {
        "total_pages": payload.get("total_pages", 0),
        "overall_avg_confidence": payload.get("overall_avg_confidence"),
        "engine_time_seconds": payload.get("processing_time_seconds"),
        "line_count": sum(page.get("line_count", 0) for page in pages),
        "device": payload.get("device"),
        # False means the payload carried no boxes and the columns had to be
        # inferred from whitespace, which recovers fewer table rows.
        "geometry": has_geometry,
    }

    if not envelope["text"].strip():
        envelope["status"] = "failed"
        envelope["error"] = envelope["error"] or "OCR produced no text above the confidence floor"
    elif confidence is not None and confidence < OCR_PARTIAL_CONFIDENCE:
        envelope["status"] = "partial"
        envelope["warnings"].append(
            f"mean OCR confidence {confidence:.3f} is below {OCR_PARTIAL_CONFIDENCE}"
        )
    else:
        envelope["status"] = "success"
    # OCR carries no table geometry through to the text output.
    envelope["tables"] = []
    return envelope


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------
def process_document(
    file_path: str,
    *,
    min_confidence: float = 0.6,
    config=None,
    separate_pages: bool = True,
    max_bytes: int = MAX_FILE_BYTES,
) -> dict:
    """Extract one document and return a uniform envelope. Never raises.

    Args:
        file_path: Path to a PDF, PNG, JPG or JPEG on local disk. The caller is
            expected to have already pulled the object out of Supabase Storage.
        min_confidence: Per-line confidence floor handed to PaddleOCR. Lines
            below it are dropped by the OCR engine before they reach us.
        config: Optional `digital_extractor.ExtractConfig`. Passed straight
            through; `None` means the engine's own defaults.
        separate_pages: Offset per-page coordinates before structuring, so a
            line on page 2 cannot be merged with one at the same height on
            page 1. Set False to reproduce the engine's raw behaviour.
        max_bytes: Reject anything larger, before either engine loads.

    Returns:
        dict with a stable shape. `status` is one of "success", "partial" or
        "failed" and maps 1:1 onto the `ocr_status` enum in the database;
        `engine` records which extractor produced the text.
    """
    started_at = time.time()
    envelope = _envelope(file_path)

    # ---- Preconditions -------------------------------------------------
    try:
        path = Path(file_path)
        if not path.exists():
            envelope["error"] = f"file not found: {path}"
            return _finalize(envelope, started_at)
        if not path.is_file():
            envelope["error"] = f"not a regular file: {path}"
            return _finalize(envelope, started_at)

        size = path.stat().st_size
        if size == 0:
            envelope["error"] = f"file is empty: {path}"
            return _finalize(envelope, started_at)
        if size > max_bytes:
            envelope["error"] = f"file is {size} bytes, over the {max_bytes} byte limit"
            return _finalize(envelope, started_at)

        detected, warnings = detect_file_type(path)
        envelope["file"]["detected_type"] = detected
        envelope["routing"]["detected_type"] = detected
        envelope["warnings"].extend(warnings)

        if detected == "unsupported":
            envelope["error"] = (
                f"unsupported file type '{path.suffix.lower() or '(no extension)'}'; "
                f"expected PDF, PNG, JPG or JPEG"
            )
            return _finalize(envelope, started_at)
    except Exception as exc:
        logger.exception("process_document: precondition check failed")
        envelope["error"] = f"could not inspect file: {exc}"
        return _finalize(envelope, started_at)

    target = str(path)

    # ---- Image: straight to OCR ----------------------------------------
    if detected == "image":
        envelope["routing"]["attempts"].append({"engine": "ocr", "reason": "image input"})
        try:
            payload = _run_ocr(target, min_confidence)
        except Exception as exc:
            logger.exception("OCR engine failed on image %s", target)
            envelope["error"] = f"OCR engine failed: {exc}"
            return _finalize(envelope, started_at)
        _fill_from_ocr(envelope, payload)
        return _finalize(envelope, started_at)

    # ---- PDF: digital first --------------------------------------------
    digital_result = None
    digital_error: str | None = None
    try:
        digital_result = _run_digital(target, config)
    except Exception as exc:
        # The engine catches its own errors and reports status="error"; getting
        # here means the import or the call itself blew up.
        logger.exception("Digital engine raised on %s", target)
        digital_error = str(exc)

    if digital_result is None:
        envelope["routing"]["attempts"].append(
            {"engine": "digital", "status": "error", "reason": digital_error}
        )
        fallback_reason = f"digital engine unavailable or crashed: {digital_error}"
    else:
        digital_status = getattr(digital_result, "status", "error")
        envelope["routing"]["attempts"].append(
            {"engine": "digital", "status": digital_status, "reason": None}
        )
        fallback_reason = _needs_ocr_fallback(digital_result)

    if fallback_reason is None:
        _fill_from_digital(envelope, digital_result, separate_pages)
        if envelope["metrics"]:
            return _finalize(envelope, started_at)
        # Text but no test rows: typically a digital letterhead stamped over a
        # scanned body, which is_digital() cannot tell from a real digital
        # report. OCR the page images and keep whichever reading found more.
        return _finalize(
            _retry_digital_with_ocr(envelope, target, min_confidence), started_at
        )

    # ---- Fallback: rasterise through OCR -------------------------------
    envelope["routing"]["fallback"] = True
    envelope["routing"]["fallback_reason"] = fallback_reason
    envelope["routing"]["attempts"].append({"engine": "ocr", "reason": fallback_reason})
    if digital_result is not None and hasattr(digital_result, "summary"):
        envelope["diagnostics"]["digital"] = digital_result.summary()

    try:
        payload = _run_ocr(target, min_confidence)
    except Exception as exc:
        logger.exception("OCR fallback failed on %s", target)
        # Prefer degraded digital text over nothing at all.
        if digital_result is not None and getattr(digital_result, "tokens", None):
            _fill_from_digital(envelope, digital_result, separate_pages)
            envelope["status"] = "partial"
            envelope["warnings"].append(f"OCR fallback failed: {exc}; kept digital text")
            return _finalize(envelope, started_at)
        envelope["error"] = f"{fallback_reason}; OCR fallback also failed: {exc}"
        return _finalize(envelope, started_at)

    _fill_from_ocr(envelope, payload)
    return _finalize(envelope, started_at)


# --------------------------------------------------------------------------
# Backend adapter
# --------------------------------------------------------------------------
def to_ingest_payload(
    result: dict,
    storage_path: str,
    appointment_id: str | None = None,
) -> dict:
    """Shape an envelope into the body of ``POST /lab-reports``.

    Mirrors `ocrPayloadSchema`: metrics carry key/value/unit/confidence and,
    when known, `source` (where the row is printed, as page fractions),
    `confidence` is clamped to [0, 1] because the validator rejects anything
    outside it, and optional fields are omitted rather than sent as null.
    """
    metrics = []
    for metric in result.get("metrics", []) or []:
        item: dict[str, Any] = {"key": metric["key"], "value": metric["value"]}
        if metric.get("unit"):
            item["unit"] = metric["unit"]
        confidence = metric.get("confidence")
        if isinstance(confidence, (int, float)):
            item["confidence"] = max(0.0, min(1.0, float(confidence)))
        if metric.get("source"):
            item["source"] = metric["source"]
        metrics.append(item)

    payload: dict[str, Any] = {
        "storagePath": storage_path,
        "metrics": metrics,
        "ocrStatus": result.get("status", "failed"),
    }
    if appointment_id:
        payload["appointmentId"] = appointment_id
    if result.get("report_date"):
        payload["reportDate"] = result["report_date"]
    return payload


# --------------------------------------------------------------------------
# CLI - lets the Node side shell out, and makes the module checkable by hand
# --------------------------------------------------------------------------
def _main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("file", help="path to a PDF, PNG, JPG or JPEG")
    parser.add_argument("--min-confidence", type=float, default=0.6)
    parser.add_argument("--storage-path", help="emit the POST /lab-reports body instead")
    parser.add_argument("--appointment-id")
    parser.add_argument("--indent", type=int, default=2)
    parser.add_argument("--quiet", action="store_true", help="omit text and page bodies")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    # stdout carries exactly one JSON document, which the Node side parses.
    # Paddle's C++ runtime logs straight to file descriptor 1, below anything
    # Python's sys.stdout can intercept, so the descriptor itself is pointed at
    # stderr while the engines run and restored only to write the result.
    json_out = _reserve_stdout()
    try:
        result = process_document(args.file, min_confidence=args.min_confidence)
    finally:
        json_out = _restore_stdout(json_out)

    if args.storage_path:
        out: dict = to_ingest_payload(result, args.storage_path, args.appointment_id)
    else:
        out = dict(result)
        if args.quiet:
            out.pop("text", None)
            out["pages"] = [
                {k: v for k, v in page.items() if k != "text"} for page in out.get("pages", [])
            ]

    # ensure_ascii keeps the output independent of the console code page
    # (cp1252 on Windows cannot encode "µ" or "≤"); JSON.parse decodes it.
    json_out.write(json.dumps(out, indent=args.indent, ensure_ascii=True, default=str))
    json_out.write("\n")
    json_out.flush()
    return 0 if result["status"] != "failed" else 1


def _reserve_stdout():
    """Send fd 1 to stderr; return a handle on the original stdout.

    Returns None when stdout has no usable descriptor (some embedded or test
    runners), in which case nothing is redirected.
    """
    try:
        sys.stdout.flush()
        saved_fd = os.dup(1)
        os.dup2(2, 1)
    except (OSError, ValueError, AttributeError):
        return None
    return saved_fd


def _restore_stdout(saved_fd):
    """Undo `_reserve_stdout` and return a text stream for the JSON result."""
    if saved_fd is None:
        return sys.stdout
    try:
        sys.stdout.flush()
    except (OSError, ValueError):
        pass
    os.dup2(saved_fd, 1)
    os.close(saved_fd)
    return sys.stdout


if __name__ == "__main__":
    raise SystemExit(_main())
