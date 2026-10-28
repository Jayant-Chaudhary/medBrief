"""Run the production OCR pipeline over a folder of reports for the benchmark.

Calls `document_processor.process_document` exactly as the FastAPI
`/document/process` route does (same `min_confidence`), and keeps the metrics
in the shape the API ingests. Writes one JSON file the scorer reads.

    python bench/run_current.py bench/reports bench/out/current.json
    python bench/run_current.py bench/reports bench/out/current.json --template bench/out/ground_truth.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

OCR_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(OCR_DIR))

import document_processor as dp  # noqa: E402

SUPPORTED = {".pdf", ".png", ".jpg", ".jpeg"}
# The production route's default (PaddleOCRFastAPI/routers/document.py).
MIN_CONFIDENCE = 0.6


def report_files(folder: Path) -> list[Path]:
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in SUPPORTED)


def warm_up() -> float:
    """Load the OCR engine once, so its start-up is not billed to the first report."""
    started = time.perf_counter()
    try:
        # _load_ocr_engine only imports the module; get_ocr() builds the
        # PaddleOCR models (cached), which is the real start-up cost.
        dp._load_ocr_engine().get_ocr()
    except Exception as exc:  # noqa: BLE001 - reported, the run can still time digital PDFs
        print(f"warning: OCR engine did not load: {exc}", file=sys.stderr)
    return time.perf_counter() - started


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("reports", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--template", type=Path, help="also write a ground-truth CSV pre-filled from this run")
    args = parser.parse_args()

    files = report_files(args.reports)
    if not files:
        print(f"no PDF/PNG/JPG files in {args.reports}", file=sys.stderr)
        return 1

    load_seconds = warm_up()
    results = []
    for path in files:
        started = time.perf_counter()
        envelope = dp.process_document(str(path), min_confidence=MIN_CONFIDENCE)
        seconds = time.perf_counter() - started
        results.append(
            {
                "file": path.name,
                "status": envelope.get("status"),
                "engine": envelope.get("engine"),
                "pages": envelope.get("page_count") or 0,
                "seconds": round(seconds, 3),
                "error": envelope.get("error"),
                "metrics": [
                    {
                        "key": m.get("key"),
                        "value": m.get("value"),
                        "unit": m.get("unit"),
                        "reference": m.get("reference"),
                        "confidence": m.get("confidence"),
                    }
                    for m in envelope.get("metrics", []) or []
                ],
            }
        )
        print(f"{path.name}: {envelope.get('engine')}, {len(results[-1]['metrics'])} values, {seconds:.1f}s")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"engine": "current (pdfplumber + PaddleOCR)", "load_seconds": round(load_seconds, 2), "files": results}, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {args.out}")

    if args.template:
        args.template.parent.mkdir(parents=True, exist_ok=True)
        with args.template.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["file", "test", "value", "unit"])
            for result in results:
                for m in result["metrics"]:
                    writer.writerow([result["file"], m["key"], m["value"], m["unit"] or ""])
        print(f"wrote {args.template} - correct it against the printed reports, then pass it to the scorer")
    return 0


if __name__ == "__main__":
    sys.exit(main())
