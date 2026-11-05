# Build from the repository root so the lab-report pipeline (../ocr) is in the
# build context:   docker build -f PaddleOCRFastAPI/Dockerfile .
# (docker-compose.yml in this folder already does that; so does Railway,
# see railway.json.)
# Bookworm (Debian 12): bullseye is past end of life and its security
# repository is gone from the mirrors, so apt-get fails on it.
FROM python:3.12-slim-bookworm

EXPOSE 8000

WORKDIR /app

ENV PADDLE_PDX_MODEL_SOURCE=BOS \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    OCR_PIPELINE_DIR=/app/pipeline \
    OCR_DEVICE=cpu \
    PYTHONUNBUFFERED=1

COPY PaddleOCRFastAPI/requirements.txt /app/requirements.txt

# 安装系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libgl1 \
        libgomp1 \
        libglib2.0-0 \
        libsm6 \
        libxrender1 \
        libxext6 \
        ccache && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
RUN python3 -m pip install --upgrade pip && \
    pip3 install --no-cache-dir -r requirements.txt

# Bake the OCR models into the image. Built through the pipeline's own
# get_ocr(), so these are exactly the models the service loads; they land in
# /root/.paddlex. Without this every container start downloads them again,
# since hosts such as Railway start each deploy on a fresh disk. Only
# ocr_extractor.py is copied first so edits elsewhere keep this layer cached.
COPY ocr/ocr_extractor.py /app/pipeline/ocr_extractor.py
RUN python3 -c "import sys; sys.path.insert(0, '/app/pipeline'); import ocr_extractor; ocr_extractor.get_ocr()"

COPY PaddleOCRFastAPI/ /app
COPY ocr/*.py /app/pipeline/

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
    CMD python3 -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=4)"

# Railway assigns the port through $PORT; locally it falls back to 8000.
# An empty host binds every interface on both IPv4 and IPv6: Railway's
# private network is IPv6, while its healthcheck and newer environments use
# IPv4. (`::` alone is IPv6-only here, because asyncio sets IPV6_V6ONLY.)
# One worker: each worker process loads its own copy of the OCR models.
# Scale with more containers rather than more workers per container.
# `exec` makes uvicorn PID 1, so a redeploy's SIGTERM reaches it and it shuts
# down cleanly instead of being killed after the grace period.
CMD ["sh", "-c", "exec uvicorn main:app --host '' --port ${PORT:-8000} --workers 1"]
