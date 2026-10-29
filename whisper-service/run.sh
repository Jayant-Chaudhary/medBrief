#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LD_LIBRARY_PATH="$SCRIPT_DIR/venv/lib/python3.12/site-packages/nvidia/cublas/lib:$SCRIPT_DIR/venv/lib/python3.12/site-packages/nvidia/cudnn/lib:$LD_LIBRARY_PATH"
cd "$SCRIPT_DIR"
exec "$SCRIPT_DIR/venv/bin/uvicorn" main:app --host 0.0.0.0 --port 8001
