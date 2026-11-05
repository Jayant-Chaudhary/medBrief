# OCR benchmark: current pipeline vs Docling

Runs both engines on the same real lab reports and scores them with the app's
own rules, to decide with evidence whether Docling should replace or add to
the PaddleOCR pipeline. Nothing here is used by the app.

The report compares, per engine:

- values read, and how many matched the metric dictionary
- values flagged for the doctor to review, and why
- values where the reference range was read as the result (the MCHC failure)
- median seconds per page, and one-off model load time
- with a ground-truth file: correct rows, recall and precision

It ends with a decision: Docling wins only if it is more accurate **and**
at most about 2x slower per page.

## 1. Get reports (git-ignored: real patient data)

Put PDFs/photos in `bench/reports/`, or pull the latest uploads (read-only):

```bash
cd server
node scripts/benchFetchReports.js --limit 10
```

## 2. Run both engines

From `ocr/`:

```bash
python bench/run_current.py bench/reports bench/out/current.json --template bench/out/ground_truth.csv
bench/.venv-docling/Scripts/python bench/run_docling.py bench/reports bench/out/docling.json
```

`run_docling.py --ocr easyocr|tesseract|rapidocr` switches Docling's OCR
engine (default `rapidocr`, which uses PaddleOCR's models via ONNX).

First-time Docling setup (its own venv, so PyTorch never touches the Paddle
environment): see `requirements-docling.txt`.

## 3. Score

From `server/`:

```bash
node scripts/benchStandardize.js ../ocr/bench/out/current.json ../ocr/bench/out/docling.json > ../ocr/bench/out/report.md
```

## Ground truth (recommended)

`--template` in step 2 writes `bench/out/ground_truth.csv`, pre-filled from the
current pipeline (`file,test,value,unit`). Correct it against the printed
reports (fix wrong values, add missed tests, delete rows that are not tests),
then score with `--truth ../ocr/bench/out/ground_truth.csv`. Without it the
report still compares flags, ranges-read-as-values and speed, but can't say
which engine is *right*.

## Tests

```bash
python -m unittest bench/test_table_rows.py
```
