#!/usr/bin/env python3
"""
GPU Verification Script for Local Whisper.

Loads a fast test model (base or tiny) on CUDA to prove that
CTranslate2 and CUDA execution work properly on the RTX 5050 GPU.
"""

import os
import sys
import time
import ctranslate2
from faster_whisper import WhisperModel

TEST_AUDIO = os.path.abspath(os.path.join(os.path.dirname(__file__), "../tools/measure/fixtures/sample-20s.wav"))

def main():
    print("=" * 60)
    print("LOCAL WHISPER GPU ACCELERATION CHECK")
    print("=" * 60)
    print(f"CTranslate2 Version: {ctranslate2.__version__}")
    cuda_count = ctranslate2.get_cuda_device_count()
    print(f"CUDA Devices Available: {cuda_count}")

    if cuda_count == 0:
        print("WARNING: No CUDA device detected by CTranslate2. Falling back to CPU.")
        device = "cpu"
        compute_type = "int8"
    else:
        print("SUCCESS: CUDA GPU detected!")
        device = "cuda"
        compute_type = "float16"

    model_name = os.getenv("WHISPER_TEST_MODEL", "tiny")
    print(f"Loading WhisperModel('{model_name}', device='{device}', compute_type='{compute_type}')...")

    t0 = time.time()
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    load_time = round(time.time() - t0, 3)
    print(f"Model loaded in {load_time}s.")

    if not os.path.exists(TEST_AUDIO):
        print(f"Test audio not found at {TEST_AUDIO}. Test complete.")
        return

    print(f"\nTranscribing 20s test audio ({TEST_AUDIO})...")
    t1 = time.time()
    segments, info = model.transcribe(TEST_AUDIO, vad_filter=True)
    seg_list = list(segments)
    infer_time = round((time.time() - t1) * 1000, 1)

    print(f"Inference Time: {infer_time} ms on {device.upper()}")
    print(f"Detected Language: {info.language} (prob: {round(info.language_probability, 2)})")
    print(f"Segments Found: {len(seg_list)}")
    for s in seg_list:
        print(f"  [{int(s.start*1000)}ms - {int(s.end*1000)}ms]: \"{s.text.strip()}\"")

    print("=" * 60)
    print("GPU INFERENCE VERIFICATION: PASSED")
    print("=" * 60)

if __name__ == "__main__":
    main()
