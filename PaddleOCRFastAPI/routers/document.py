# -*- coding: utf-8 -*-
"""
Lab-report extraction endpoint for the Health-On backend.

Runs the project's own pipeline (ocr/document_processor.py): pdfplumber for
digital PDFs, PaddleOCR for scans and photos, one structured envelope out.
Serving it from this long-lived process is the point - the PaddleOCR models
load once and stay resident, where a process per upload reloads them (tens of
seconds) on every request and runs several copies side by side under load.
"""

import logging
import os
import sys
import tempfile
import threading
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

logger = logging.getLogger(__name__)

#: Where document_processor.py lives. In the repo it is ../ocr next to this
#: service; the Docker image copies it to the path set in the Dockerfile.
PIPELINE_DIR = Path(
    os.environ.get("OCR_PIPELINE_DIR")
    or Path(__file__).resolve().parents[2] / "ocr"
)
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from document_processor import process_document, to_ingest_payload  # noqa: E402

#: Set by the warm-up thread; reported by /health so a deploy can wait on it.
warmup_state = {"status": "pending", "error": None}


def _warm_up():
    """Load (and on first run, download) the OCR models before any upload.

    Otherwise the first scanned report after every deploy pays that cost
    inside the backend's request timeout.
    """
    try:
        import ocr_extractor  # noqa: PLC0415 - heavy import, off the startup path

        ocr_extractor.verify_gpu_status()
        with ocr_extractor._ocr_lock:
            ocr_extractor.get_ocr()
            if ocr_extractor.image_autorotate_enabled():
                ocr_extractor.get_orientation_classifier()
        warmup_state["status"] = "ready"
    except Exception as exc:  # the service still serves digital PDFs
        logger.exception("OCR warm-up failed")
        warmup_state.update(status="failed", error=str(exc))


def start_warm_up() -> None:
    if os.environ.get("OCR_WARMUP", "1").lower() in {"0", "false", "no"}:
        warmup_state["status"] = "skipped"
        return
    threading.Thread(target=_warm_up, name="ocr-warmup", daemon=True).start()


#: Hard cap on an upload, checked while reading so an oversized body is never
#: held in memory whole. Matches the pipeline's own ceiling by default.
MAX_UPLOAD_BYTES = int(os.environ.get("OCR_MAX_UPLOAD_BYTES", 64 * 1024 * 1024))

ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg"}

router = APIRouter(prefix="/document", tags=["Lab report extraction"])


def _suffix(filename: Optional[str]) -> str:
    # Lower-cased: phones name photos IMG_1234.JPG. The pipeline sniffs the
    # real type from the file's bytes anyway; the suffix is only a hint.
    suffix = Path(filename or "").suffix.lower()
    return suffix if suffix in ALLOWED_SUFFIXES else ".bin"


def _read_capped(upload: UploadFile) -> bytes:
    data = upload.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {MAX_UPLOAD_BYTES} byte limit",
        )
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty")
    return data


# A plain `def`, not `async def`: extraction blocks for seconds, and FastAPI
# runs sync endpoints on its thread pool instead of stalling the event loop.
# PaddleOCR calls are serialized by the lock inside ocr_extractor.
@router.post("/process", summary="Extract a lab report (PDF or photo) into metrics")
def process(
    file: UploadFile = File(...),
    storage_path: str = Form(...),
    appointment_id: Optional[str] = Form(None),
    min_confidence: float = Form(0.6),
):
    data = _read_capped(file)
    fd, tmp_path = tempfile.mkstemp(prefix="lab-report-", suffix=_suffix(file.filename))
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        # Never raises: every failure comes back as status="failed".
        result = process_document(tmp_path, min_confidence=min_confidence)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            logger.warning("Could not remove temp file %s", tmp_path)

    # The temp name means nothing to the caller; report the uploaded one.
    result["file"]["name"] = file.filename
    result["file"]["path"] = None
    return {
        "ingest": to_ingest_payload(result, storage_path, appointment_id),
        "result": result,
    }
