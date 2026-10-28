"""
Scanned-document text extraction with PaddleOCR.

Notes
-----
1. `paddle` and `paddleocr` are imported on first use, not at module import.
   They pull in a CUDA runtime and cost seconds to load; a backend that only
   ever sees digital PDFs should not pay for that, and the parsing helpers
   below stay testable on a machine with neither installed.
2. The device is resolved, not assumed. Asking for "gpu" on a box without one
   is a hard failure inside PaddleOCR, so availability is checked first and
   CPU is a real fallback rather than a printed intention.
3. Recognition results keep their bounding boxes. The polygons are what carry
   the column structure of a lab report; dropping them and returning bare
   lines throws away the only thing that can tell a test name from its value.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Sequence

logger = logging.getLogger(__name__)

#: Set OCR_DEVICE=cpu to force CPU even where a GPU exists (useful in CI).
DEVICE_ENV_VAR = "OCR_DEVICE"

#: Overridable with OCR_DET_MODEL / OCR_REC_MODEL. Needs PaddleOCR >= 3.7.
DEFAULT_DET_MODEL = "PP-OCRv6_small_det"
DEFAULT_REC_MODEL = "PP-OCRv6_small_rec"

#: PaddleOCR instances are expensive to build - one model load each - and are
#: safe to reuse across documents. Keyed by the settings that affect the model.
_ocr_instances: dict[tuple[str, str, bool], Any] = {}

#: A PaddleOCR predictor is not safe to call from two threads at once, and a
#: long-lived server (the FastAPI worker) serves requests from a thread pool.
#: One lock serializes model construction and inference in this process.
_ocr_lock = threading.Lock()


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# --------------------------------------------------------------------------
# Device resolution
# --------------------------------------------------------------------------
def gpu_available() -> bool:
    """True only if Paddle was built with CUDA *and* a device is visible.

    `is_compiled_with_cuda()` alone answers a different question - whether the
    installed wheel has CUDA support - and returns True on a GPU build running
    on a machine with no GPU.
    """
    try:
        import paddle  # noqa: PLC0415 - deliberate lazy import

        if not paddle.device.is_compiled_with_cuda():
            return False
        return paddle.device.cuda.device_count() > 0
    except Exception as exc:
        logger.debug("GPU probe failed: %s", exc)
        return False


def resolve_device(preferred: str | None = None) -> str:
    """Pick the device to run on: explicit argument, env var, then autodetect."""
    requested = (preferred or os.environ.get(DEVICE_ENV_VAR) or "auto").strip().lower()

    if requested == "cpu":
        return "cpu"
    if gpu_available():
        return "gpu"
    if requested == "gpu":
        logger.warning("device='gpu' requested but no usable CUDA device found; using CPU")
    return "cpu"


def verify_gpu_status() -> str:
    """Report - and return - the device OCR will actually use.

    Logs rather than prints: when the pipeline runs as a CLI, stdout is
    reserved for the JSON result the Node side parses.
    """
    try:
        import paddle  # noqa: PLC0415

        compiled = paddle.device.is_compiled_with_cuda()
    except ImportError:
        logger.error("paddlepaddle is not installed; OCR is unavailable.")
        return "unavailable"
    except Exception as exc:
        logger.warning("Could not verify GPU: %s", exc)
        return resolve_device()

    device = resolve_device()
    if device == "gpu":
        logger.info("GPU acceleration active.")
    elif compiled:
        logger.warning("PaddlePaddle-GPU installed, but no CUDA device is visible. Using CPU.")
    else:
        logger.info("PaddlePaddle built without CUDA. Using CPU.")
    return device


def get_ocr(device: str | None = None, lang: str = "en", textline_orientation: bool = True):
    """Return a cached PaddleOCR instance for these settings."""
    from paddleocr import PaddleOCR  # noqa: PLC0415 - deliberate lazy import

    resolved = resolve_device(device)
    key = (resolved, lang, textline_orientation)
    if key not in _ocr_instances:
        logger.info("Loading PaddleOCR (device=%s, lang=%s)", resolved, lang)
        kwargs: dict[str, Any] = {
            "use_textline_orientation": textline_orientation,
            "lang": lang,
            "device": resolved,
            # PaddleOCR 3.x turns both of these on by default. Whole-page
            # orientation and UVDoc unwarping add two model loads and most of
            # the per-page runtime, and unwarping bends flat scans enough to
            # corrupt glyphs. Opt back in for curled phone photos.
            "use_doc_orientation_classify": _env_flag("OCR_DOC_ORIENTATION", False),
            "use_doc_unwarping": _env_flag("OCR_DOC_UNWARPING", False),
        }
        # The small models read a one-page CPU scan in ~10s where PaddleOCR's
        # default medium models took ~80s, with the same rows recovered on
        # our samples. On a GPU box, set these to the *_medium_* models.
        kwargs["text_detection_model_name"] = os.environ.get("OCR_DET_MODEL") or DEFAULT_DET_MODEL
        kwargs["text_recognition_model_name"] = os.environ.get("OCR_REC_MODEL") or DEFAULT_REC_MODEL
        _ocr_instances[key] = PaddleOCR(**kwargs)
    return _ocr_instances[key]


# --------------------------------------------------------------------------
# Result parsing (no paddle import - unit testable on its own)
# --------------------------------------------------------------------------
def bbox_from_poly(poly) -> list[float] | None:
    """Axis-aligned [x0, y0, x1, y1] from a detection polygon."""
    try:
        xs = [float(point[0]) for point in poly]
        ys = [float(point[1]) for point in poly]
    except (TypeError, ValueError, IndexError):
        return None
    if not xs or not ys:
        return None
    return [min(xs), min(ys), max(xs), max(ys)]


def _polys(fields) -> Sequence:
    """The polygons that line up index-for-index with `rec_texts`.

    In PaddleOCR 3.x `dt_polys` is every *detected* box, while `rec_texts`,
    `rec_scores` and `rec_polys` are the boxes that survived recognition
    filtering - so `dt_polys[i]` is not necessarily the box of `rec_texts[i]`.
    `dt_polys` is only a fallback for older results that lack `rec_polys`.
    """
    polys = fields.get("rec_polys")
    if polys is None or len(polys) == 0:
        polys = fields.get("dt_polys", [])
    return polys if polys is not None else []


def _raw_fields(page_result) -> tuple[Sequence, Sequence, Sequence]:
    """Pull (texts, scores, polys) out of whichever result shape we were given."""
    if hasattr(page_result, "keys"):
        fields = page_result
    elif hasattr(page_result, "res") and isinstance(page_result.res, dict):
        fields = page_result.res
    else:
        return [], [], []
    texts = fields.get("rec_texts", [])
    scores = fields.get("rec_scores", [])
    return (
        texts if texts is not None else [],
        scores if scores is not None else [],
        _polys(fields),
    )


def _reading_order(items: list[dict]) -> list[dict]:
    """Sort boxes into reading order: rows top to bottom, then left to right.

    Sorting on `top` alone is not enough. Boxes on one visual row come back
    with a few pixels of jitter, so an exact sort interleaves the columns -
    a real page put its header out as Result, Test Name, Bio. Ref. Interval,
    Units. Boxes are grouped into rows within half a line height first, and
    each row is then ordered by x.
    """
    placed = [item for item in items if item.get("bbox")]
    unplaced = [item for item in items if not item.get("bbox")]
    if not placed:
        return unplaced

    heights = sorted(item["bbox"][3] - item["bbox"][1] for item in placed)
    row_tolerance = max(heights[len(heights) // 2] * 0.5, 1.0)

    placed.sort(key=lambda item: (item["bbox"][1] + item["bbox"][3]) / 2)

    rows: list[list[dict]] = [[placed[0]]]
    row_center = (placed[0]["bbox"][1] + placed[0]["bbox"][3]) / 2
    for item in placed[1:]:
        center = (item["bbox"][1] + item["bbox"][3]) / 2
        if abs(center - row_center) <= row_tolerance:
            rows[-1].append(item)
        else:
            rows.append([item])
            row_center = center

    ordered: list[dict] = []
    for row in rows:
        row.sort(key=lambda item: item["bbox"][0])
        ordered.extend(row)
    # Boxes with no geometry keep their detection order, at the end.
    return ordered + unplaced


def page_items(page_result, min_confidence: float = 0.6) -> list[dict]:
    """Recognized boxes for one page, in reading order, above the confidence floor."""
    if not page_result:
        return []

    texts, scores, polys = _raw_fields(page_result)
    items: list[dict] = []

    if len(texts) > 0:
        for i, raw_text in enumerate(texts):
            text = (raw_text or "").strip()
            if not text:
                continue
            try:
                confidence = float(scores[i])
            except (IndexError, TypeError, ValueError):
                confidence = 0.0
            if confidence < min_confidence:
                continue
            bbox = bbox_from_poly(polys[i]) if i < len(polys) else None
            items.append(
                {
                    "text": text,
                    "confidence": confidence,
                    "bbox": bbox,
                    # Detection order is the tiebreak when there is no geometry.
                    "_order": (bbox[1] if bbox else float(i), bbox[0] if bbox else 0.0),
                }
            )
    elif isinstance(page_result, list) and page_result and isinstance(page_result[0], list):
        # Legacy PaddleOCR 2.x shape: [[poly, (text, score)], ...]
        for i, line in enumerate(page_result):
            try:
                poly, (raw_text, score) = line[0], line[1]
                text = (raw_text or "").strip()
                confidence = float(score)
            except (IndexError, TypeError, ValueError):
                continue
            if not text or confidence < min_confidence:
                continue
            bbox = bbox_from_poly(poly)
            items.append(
                {
                    "text": text,
                    "confidence": confidence,
                    "bbox": bbox,
                    "_order": (bbox[1] if bbox else float(i), bbox[0] if bbox else 0.0),
                }
            )

    # Detection order is the only tiebreak available for boxes with no geometry.
    items.sort(key=lambda item: item["_order"])
    for item in items:
        del item["_order"]
    return _reading_order(items)


def page_size(page_result) -> tuple[int | None, int | None]:
    """(width, height) in pixels of the page image PaddleOCR read.

    Box coordinates are in this image's pixels, so the size is what turns a box
    into a position on the page. PaddleOCR 3.x keeps the image it worked on
    under doc_preprocessor_res.output_img even with the preprocessor steps off.
    """
    try:
        fields = page_result if hasattr(page_result, "keys") else getattr(page_result, "res", None)
        image = (fields.get("doc_preprocessor_res") or {}).get("output_img")
        height, width = image.shape[:2]
        return int(width), int(height)
    except Exception:  # noqa: BLE001 - older result shapes carry no image
        return None, None


def _page_payload(page_number: int, items: list[dict], width: int | None = None, height: int | None = None) -> dict:
    lines = [item["text"] for item in items]
    confidences = [item["confidence"] for item in items]
    return {
        "page_number": page_number,
        # Pixel size of the page image the boxes below are measured in.
        "width": width,
        "height": height,
        "line_count": len(lines),
        "avg_confidence": round(sum(confidences) / len(confidences), 3) if confidences else 0.0,
        "lines": lines,
        "text": "\n".join(lines),
        # Geometry, kept so downstream can rebuild columns rather than guess.
        "items": items,
    }


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------
def extract_and_format(
    file_path: str,
    min_confidence: float = 0.6,
    device: str | None = None,
    lang: str = "en",
) -> dict:
    """OCR one PDF or image and return its text page by page.

    Args:
        file_path: PDF, PNG, JPG or JPEG. PaddleOCR rasterizes PDFs itself.
        min_confidence: Drop recognitions below this score.
        device: "gpu", "cpu", or None to autodetect (honours $OCR_DEVICE).
        lang: PaddleOCR language model.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found at: {file_path}")

    started_at = time.time()
    resolved_device = resolve_device(device)
    with _ocr_lock:
        ocr = get_ocr(resolved_device, lang=lang)

    logger.info("Starting OCR (%s) for: %s", resolved_device, file_path)
    # Pages are reduced to their text boxes as they stream out: each raw result
    # carries the rendered page image, and holding every one of them at once
    # is what exhausts memory on a long scanned PDF.
    with _ocr_lock:
        pages = [
            _page_payload(index + 1, page_items(page_result, min_confidence), *page_size(page_result))
            for index, page_result in enumerate(ocr.predict(file_path))
        ]

    all_confidences = [item["confidence"] for page in pages for item in page["items"]]

    return {
        "file_name": os.path.basename(file_path),
        "file_path": os.path.abspath(file_path),
        "device": resolved_device,
        "total_pages": len(pages),
        "overall_avg_confidence": (
            round(sum(all_confidences) / len(all_confidences), 3) if all_confidences else 0.0
        ),
        "processing_time_seconds": round(time.time() - started_at, 2),
        "pages": pages,
    }


#: Kept for callers written against the original name. It was never
#: PDF-only - PaddleOCR reads images through the same path.
def extract_and_format_pdf_gpu(pdf_path: str, min_confidence: float = 0.6) -> dict:
    return extract_and_format(pdf_path, min_confidence=min_confidence)
