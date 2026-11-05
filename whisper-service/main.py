"""
Local Whisper Microservice using faster-whisper.

Provides high-performance, local GPU-accelerated speech-to-text
using CTranslate2 and Whisper models (default: large-v3-turbo).
"""

import os
import re
import tempfile
import logging
from typing import Optional, List
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from pydantic import BaseModel
import ctranslate2

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("whisper-service")

app = FastAPI(title="MedBrief Local Whisper STT Service", version="1.0.0")

has_cuda = ctranslate2.get_cuda_device_count() > 0
MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
DEFAULT_DEVICE = os.getenv("WHISPER_DEVICE", "cuda" if has_cuda else "cpu")
DEFAULT_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "float16" if DEFAULT_DEVICE == "cuda" else "int8")

logger.info(f"Targeting device: {DEFAULT_DEVICE}, compute_type: {DEFAULT_COMPUTE_TYPE}, model: {MODEL_NAME}")

# Anti-hallucination tunables (env-overridable; no audio or text is ever logged).
NO_SPEECH_THRESHOLD = float(os.getenv("WHISPER_NO_SPEECH_THRESHOLD", "0.6"))
LOG_PROB_THRESHOLD = float(os.getenv("WHISPER_LOG_PROB_THRESHOLD", "-1.0"))
COMPRESSION_RATIO_THRESHOLD = float(os.getenv("WHISPER_COMPRESSION_RATIO_THRESHOLD", "2.4"))
VAD_THRESHOLD = float(os.getenv("WHISPER_VAD_THRESHOLD", "0.6"))
VAD_MIN_SPEECH_MS = int(os.getenv("WHISPER_VAD_MIN_SPEECH_MS", "250"))
VAD_MIN_SILENCE_MS = int(os.getenv("WHISPER_VAD_MIN_SILENCE_MS", "500"))
REPEAT_UNIT_MAX_LEN = int(os.getenv("WHISPER_REPEAT_UNIT_MAX_LEN", "6"))
REPEAT_MIN_COUNT = int(os.getenv("WHISPER_REPEAT_MIN_COUNT", "6"))
ALLOWED_LANGUAGES = [
    l.strip() for l in os.getenv("WHISPER_ALLOWED_LANGUAGES", "en,hi").split(",") if l.strip()
]

_REPEAT_RE = re.compile(r"(.{1,%d}?)\1{%d,}" % (REPEAT_UNIT_MAX_LEN, REPEAT_MIN_COUNT - 1), re.DOTALL)


def is_hallucination(seg) -> bool:
    """True for segments that look like noise decoded as text."""
    text = seg.text.strip()
    if not text:
        return True
    if getattr(seg, "compression_ratio", 0) > COMPRESSION_RATIO_THRESHOLD:
        return True
    if (
        getattr(seg, "no_speech_prob", 0) > NO_SPEECH_THRESHOLD
        and getattr(seg, "avg_logprob", 0) < LOG_PROB_THRESHOLD
    ):
        return True
    # Repetition loops such as "aajijijiji..." score high logprob, so check the text itself.
    return bool(_REPEAT_RE.search(text))


model = None

def get_model():
    global model
    if model is None:
        from faster_whisper import WhisperModel
        try:
            logger.info(f"Loading Whisper model '{MODEL_NAME}' on {DEFAULT_DEVICE} ({DEFAULT_COMPUTE_TYPE})...")
            model = WhisperModel(MODEL_NAME, device=DEFAULT_DEVICE, compute_type=DEFAULT_COMPUTE_TYPE)
            logger.info("Whisper model loaded successfully.")
        except Exception as e:
            logger.warning(f"Failed to load on {DEFAULT_DEVICE}: {e}. Falling back to CPU int8.")
            model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
            logger.info("Whisper model loaded on CPU.")
    return model

class SegmentResult(BaseModel):
    start_ms: int
    end_ms: int
    text: str
    confidence: Optional[float] = None

class TranscribeResponse(BaseModel):
    text: str
    language: str
    language_probability: float
    duration_sec: float
    dropped_count: int = 0
    segments: List[SegmentResult]

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "device": DEFAULT_DEVICE,
        "cuda_available": has_cuda,
        "cuda_device_count": ctranslate2.get_cuda_device_count(),
        "model_loaded": model is not None,
    }

@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    vad_filter: bool = Form(True),
):
    whisper = get_model()

    # Save audio upload to a temporary file for CTranslate2
    suffix = os.path.splitext(file.filename)[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = tmp.name
        content = await file.read()
        tmp.write(content)

    try:
        requested = language if language and language != "auto" else None

        def run(lang):
            gen, inf = whisper.transcribe(
                tmp_path,
                language=lang,
                vad_filter=vad_filter,
                vad_parameters=dict(
                    threshold=VAD_THRESHOLD,
                    min_speech_duration_ms=VAD_MIN_SPEECH_MS,
                    min_silence_duration_ms=VAD_MIN_SILENCE_MS,
                ),
                condition_on_previous_text=False,
                no_speech_threshold=NO_SPEECH_THRESHOLD,
                log_prob_threshold=LOG_PROB_THRESHOLD,
                compression_ratio_threshold=COMPRESSION_RATIO_THRESHOLD,
            )
            return list(gen), inf

        raw_segments, info = run(requested)
        # Auto-detect on noisy chunks can land on an unrelated language; pin to an allowed one.
        if requested is None and ALLOWED_LANGUAGES and info.language not in ALLOWED_LANGUAGES:
            raw_segments, info = run(ALLOWED_LANGUAGES[0])

        segments_list = []
        full_text_parts = []
        dropped = 0

        for seg in raw_segments:
            if is_hallucination(seg):
                dropped += 1
                continue
            clean_text = seg.text.strip()
            full_text_parts.append(clean_text)
            segments_list.append(SegmentResult(
                start_ms=int(round(seg.start * 1000)),
                end_ms=int(round(seg.end * 1000)),
                text=clean_text,
                confidence=round(float(seg.avg_logprob), 3) if hasattr(seg, 'avg_logprob') else None,
            ))

        if dropped:
            logger.info(f"Dropped {dropped} low-quality segment(s) from chunk")

        return TranscribeResponse(
            text=" ".join(full_text_parts),
            language=info.language,
            language_probability=round(float(info.language_probability), 3),
            duration_sec=round(float(info.duration), 2),
            dropped_count=dropped,
            segments=segments_list,
        )
    except Exception as e:
        err_msg = str(e)
        if ("libcublas" in err_msg or "cuda" in err_msg.lower() or "cublas" in err_msg.lower()):
            logger.warning(f"CUDA execution failed: {err_msg}. Falling back to CPU int8.")
            from faster_whisper import WhisperModel
            global model
            model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
            await file.seek(0)
            return await transcribe_audio(file=file, language=language, vad_filter=vad_filter)

        logger.error(f"Transcription error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=False)
