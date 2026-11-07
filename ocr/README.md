# OCR pipeline

Turns an uploaded lab report into the JSON object the Express backend ingests
at `POST /lab-reports`. Two extraction engines, one router.

In production this is served by `../PaddleOCRFastAPI` at `POST /document/process`
(see `server/OCR_INTEGRATION.md`), so the OCR models stay loaded between uploads.

```
ocr/
├── document_processor.py   # the router - the only module the backend calls
├── digital_extractor.py    # native-PDF text, pdfplumber + PyMuPDF, scored
├── structure_parser.py     # token stream -> patient / meta / sections / tests
├── ocr_extractor.py        # PaddleOCR (GPU) for scans and photos
└── tests/                  # routing tests, run without either engine installed
```

## Routing

```
image (png/jpg/jpeg) ─────────────────────────────► PaddleOCR
pdf ──► digital engine ──► ok / partial ──────────► digital result
                        └► scanned / garbled /
                           error / no tokens ─────► PaddleOCR
```

File type comes from the leading bytes first and the extension second - phone
uploads mislabel formats often enough that trusting the suffix is a bug.

A digital PDF whose text yields **no test rows** (typically a digital
letterhead over a scanned body) is also run through OCR, and whichever reading
found more test rows wins.

`partial` is kept on the digital engine on purpose: some pages garbled means
most pages are fine, and rasterising a readable PDF loses more than it gains.
`garbled` (the engine's verdict that *most* content pages failed) does fall
back, because broken font encodings produce text that is worse than no text.

## Usage

```python
from document_processor import process_document, to_ingest_payload

result = process_document("/tmp/downloaded-report.pdf")
payload = to_ingest_payload(result, storage_path="lab-reports/<uuid>.pdf",
                            appointment_id=appointment_id)
```

`process_document()` never raises. Every failure - missing file, unsupported
type, absent CUDA stack, engine crash - returns the same envelope with
`status="failed"` and a populated `error`, so the HTTP handler above it cannot
500 on a bad upload.

### Envelope

| key | meaning |
| --- | --- |
| `status` | `success` / `partial` / `failed` - maps 1:1 onto the `ocr_status` DB enum |
| `engine` | `digital` / `ocr` / `none` - which extractor produced the text |
| `file` | name, resolved path, extension, size, detected type |
| `text` | full plain text, pages joined by a blank line |
| `pages` | per page: number, line count, confidence, text |
| `structured` | `patient`, `report_meta`, `sections[].tests[]`, `notes`, `comments` |
| `metrics` | flattened test rows: `key`, `value`, `unit`, `reference`, `section`, `confidence` |
| `tables` | pdfplumber table matrices (digital branch only) |
| `report_date` | ISO date printed on the report, if one could be parsed |
| `confidence` | mean OCR confidence, or `1.0` for native text |
| `routing` | detected type, every engine attempt, fallback flag and reason |
| `diagnostics` | the engines' own summaries, kept verbatim for debugging |
| `warnings` | non-fatal notes (extension mismatch, low confidence, garbled pages) |
| `error` | failure reason, `null` on success |

`metrics[].key` stays exactly as printed on the report (`HGB`, `Hb`,
`Haemoglobin`). Mapping it to `metric_dictionary.standard_key` is
`standardizeLabReport.service.js`'s job, not the pipeline's.

## CLI

```bash
python document_processor.py report.pdf --quiet          # the full envelope
python document_processor.py report.pdf \
    --storage-path lab-reports/abc.pdf                   # the POST body
```

Exit code is 0 unless `status` is `failed`. stdout carries exactly one JSON
document: the engines' own logging (including Paddle's C++ runtime, which
writes straight to file descriptor 1) is redirected to stderr while they run.

## Testing

**1. Unit tests - no engine dependencies needed.**

```bash
cd ocr && python -m unittest discover -s tests
```

Both engines are stubbed through `sys.modules`, so this covers routing, every
fallback trigger, failure handling, the envelope contract, field splitting and
OCR result parsing on a machine with neither `pdfplumber` nor `paddleocr`
installed.

**2. Real PDFs - needs `pdfplumber` only.**

```bash
pip install pdfplumber pymupdf reportlab
python tests/make_sample_pdfs.py /tmp/samples

python document_processor.py /tmp/samples/digital.pdf --quiet
python document_processor.py /tmp/samples/scanned.pdf --quiet
python document_processor.py /tmp/samples/digital.pdf --storage-path lab-reports/test.pdf
```

Expect `digital.pdf` -> `engine: digital`, 4 metrics with units and reference
ranges, `report_date: 2025-10-12`; `scanned.pdf` -> `routing.fallback: true`
with `fallback_reason` naming the `scanned` verdict (then failing at the OCR
call if paddle is absent, which is the correct behaviour).

**3. The OCR engine - runs on CPU too.**

```bash
pip install paddlepaddle paddleocr        # or paddlepaddle-gpu on the GPU box
python -c "import ocr_extractor; print(ocr_extractor.verify_gpu_status())"
python document_processor.py /path/to/real-scan.jpg --quiet
```

`verify_gpu_status()` logs and returns the device actually chosen: `gpu`
when Paddle has CUDA *and* a device is visible, `cpu` otherwise. `OCR_DEVICE=cpu`
forces CPU on a GPU machine. CPU works end to end - it is just slower.

**First run downloads models** from HuggingFace / ModelScope / AIStudio / BOS.
On a network that blocks those hosts, PaddleOCR raises "No available model
hosting platforms detected" before it does any work; pre-download the models
and point at them with PaddleOCR's `*_model_dir` arguments.

Check `diagnostics.ocr.device`, `diagnostics.ocr.geometry` (should be `true`),
and that metrics came out. `geometry: false` means the detection boxes were
missing and columns had to be inferred from whitespace.

## Engine behaviour worth knowing

- **Device.** OCR autodetects: GPU when Paddle is built with CUDA *and* a
  device is visible, CPU otherwise. `OCR_DEVICE=cpu` forces CPU.
- **Test rows.** Recognized: abnormal flags in their own column or glued to
  the value (`11.2 L`, `*11.2`, `↑11.2`) - split into `metrics[].flag`;
  digit-grouped values (`1,50,000`); qualitative results (`Negative`,
  `Non Reactive`, `Pale Yellow`); a leading serial-number column. A `Note:` /
  `Comments:` block ends at the next test row or page break.
- **Zero metrics.** A document with text but no recognizable test rows is
  `partial`, not `success`, so it reaches a clinician for review.
- **Model loading.** `PaddleOCR` instances are cached per (device, lang), so
  the model loads once per process rather than once per document - which only
  pays off in a long-lived process such as the FastAPI service, not the CLI.
  Calls are serialized by a lock, so one instance is safe under a thread pool.
- **Models.** PP-OCRv6 small det/rec by default (~10s a page on CPU, versus
  ~80s for the medium models with no loss on our samples); override with
  `OCR_DET_MODEL` / `OCR_REC_MODEL`. Document orientation and UVDoc unwarping
  are off by default (`OCR_DOC_ORIENTATION` / `OCR_DOC_UNWARPING` to enable).
  Photos are still read upright: EXIF orientation is applied and a light
  0/90/180/270° page classifier runs on images only (`OCR_IMAGE_AUTOROTATE`,
  on by default; `OCR_ORIENTATION_MODEL` overrides the model).
  Requires PaddleOCR >= 3.7.
- **Geometry.** OCR results keep their detection boxes in `pages[].items[]`,
  and the router structures them with tolerances scaled from the median box
  height. Payloads without boxes fall back to inferring columns from
  whitespace, which recovers fewer table rows;
  `diagnostics.ocr.geometry` says which path ran.
- **Table cells.** Ruled-table cells touch, so `split_fields` treats a token
  whose source ends in `_table` as its own field rather than relying on a gap.
- **`is_digital()`** samples the first 3 pages only. A report with a scanned
  cover page in front of digital content is classified `scanned` and sent to
  OCR whole.
- **Prose lines** longer than 15 characters that are not key-value pairs still
  land in `sections[].title`. Harmless downstream (they carry no tests) but
  it makes the section list noisier than it should be.
