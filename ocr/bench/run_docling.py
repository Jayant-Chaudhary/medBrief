"""Run Docling over a folder of reports for the benchmark (run inside .venv-docling).

Docling finds the page layout and rebuilds tables cell by cell (TableFormer);
character reading comes from a pluggable OCR engine. `table_rows.py` turns
each table into test / value / unit rows, the same shape run_current.py writes.

    bench/.venv-docling/Scripts/python bench/run_docling.py bench/reports bench/out/docling.json
    ... --ocr easyocr        # compare Docling's OCR engines (rapidocr = PaddleOCR models via ONNX)
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from table_rows import rows_from_table  # noqa: E402

SUPPORTED = {".pdf", ".png", ".jpg", ".jpeg"}
IMAGE = {".png", ".jpg", ".jpeg"}


def build_converter(ocr: str, force_full_page_ocr: bool):
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        EasyOcrOptions,
        PdfPipelineOptions,
        RapidOcrOptions,
        TableFormerMode,
        TesseractCliOcrOptions,
    )
    from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption

    ocr_options = {
        "rapidocr": RapidOcrOptions,
        "easyocr": EasyOcrOptions,
        "tesseract": TesseractCliOcrOptions,
    }[ocr](force_full_page_ocr=force_full_page_ocr)

    options = PdfPipelineOptions(do_ocr=True, do_table_structure=True, ocr_options=ocr_options)
    options.table_structure_options.mode = TableFormerMode.ACCURATE
    options.table_structure_options.do_cell_matching = True
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=options),
            InputFormat.IMAGE: ImageFormatOption(pipeline_options=options),
        }
    )


def ocr_confidence(result) -> float | None:
    """Mean OCR score Docling reports for the pages it had to OCR, if this version exposes one."""
    report = getattr(result, "confidence", None)
    pages = getattr(report, "pages", None) or {}
    scores = [getattr(page, "ocr_score", None) for page in (pages.values() if isinstance(pages, dict) else pages)]
    scores = [s for s in scores if isinstance(s, (int, float)) and s == s and s > 0]
    return round(statistics.mean(scores), 4) if scores else None


def metrics_from_document(doc) -> tuple[list[dict], int]:
    metrics, tables = [], 0
    for table in doc.tables:
        tables += 1
        frame = table.export_to_dataframe(doc=doc)
        header = [str(c) for c in frame.columns]
        rows = frame.astype(str).values.tolist()
        metrics.extend(rows_from_table(header, rows))
    return metrics, tables


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("reports", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--ocr", choices=["rapidocr", "easyocr", "tesseract"], default="rapidocr")
    args = parser.parse_args()

    files = sorted(p for p in args.reports.iterdir() if p.suffix.lower() in SUPPORTED)
    if not files:
        print(f"no PDF/PNG/JPG files in {args.reports}", file=sys.stderr)
        return 1

    started = time.perf_counter()
    converters = {
        # Photos have no text layer: OCR the whole page. PDFs use their own
        # text where it exists and OCR only the bitmap regions.
        True: build_converter(args.ocr, force_full_page_ocr=True),
        False: build_converter(args.ocr, force_full_page_ocr=False),
    }
    # Models download and load on first use: convert the first report once,
    # untimed, so that one-off cost is not billed to it.
    warm = files[0]
    converters[warm.suffix.lower() in IMAGE].convert(str(warm))
    load_seconds = time.perf_counter() - started

    results = []
    for path in files:
        t0 = time.perf_counter()
        error, metrics, pages, tables, confidence = None, [], 0, 0, None
        try:
            result = converters[path.suffix.lower() in IMAGE].convert(str(path))
            doc = result.document
            pages = len(getattr(doc, "pages", {}) or {})
            metrics, tables = metrics_from_document(doc)
            confidence = ocr_confidence(result)
        except Exception as exc:  # noqa: BLE001 - one bad file must not end the run
            error = f"{type(exc).__name__}: {exc}"
        seconds = time.perf_counter() - t0
        for m in metrics:
            m["confidence"] = confidence
        results.append(
            {
                "file": path.name,
                "status": "failed" if error else ("success" if metrics else "partial"),
                "engine": f"docling+{args.ocr}",
                "pages": pages,
                "tables": tables,
                "seconds": round(seconds, 3),
                "error": error,
                "metrics": metrics,
            }
        )
        print(f"{path.name}: {tables} tables, {len(metrics)} values, {seconds:.1f}s" + (f" ERROR {error}" if error else ""))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"engine": f"docling ({args.ocr})", "load_seconds": round(load_seconds, 2), "files": results}, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
