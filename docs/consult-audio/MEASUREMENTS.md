# Consult-Audio Baseline Measurements

This document records the empirical performance benchmarks captured by the measurement scripts under `tools/measure/`. The developer or agent fills in this table after executing the live benchmark runs with API keys.

---

## 1. Sarvam Speech-to-Text REST (`tools/measure/sarvam-rest.js`)

Benchmark setup: 20-second 16 kHz mono WAV clip, evaluated across 5 sequential requests and 3 concurrent requests.

| Metric | Measured Value | Target / Budget | Notes |
|---|---|---|---|
| Sequential Run 1 Latency | _TBD_ | < 3,000 ms | |
| Sequential Run 2 Latency | _TBD_ | < 3,000 ms | |
| Sequential Run 3 Latency | _TBD_ | < 3,000 ms | |
| Sequential Run 4 Latency | _TBD_ | < 3,000 ms | |
| Sequential Run 5 Latency | _TBD_ | < 3,000 ms | |
| **Sequential Median (p50)** | _TBD_ | < 2,500 ms | Baseline single-chunk latency |
| **Sequential 95th Percentile (p95)** | _TBD_ | < 4,000 ms | Upper latency bound |
| Concurrent Request 1 Latency | _TBD_ | < 4,000 ms | 3 parallel requests |
| Concurrent Request 2 Latency | _TBD_ | < 4,000 ms | 3 parallel requests |
| Concurrent Request 3 Latency | _TBD_ | < 4,000 ms | 3 parallel requests |
| Rate-Limit Headers Observed | _TBD_ | None / 429 | `x-ratelimit-*` headers if present |
| Recommended `TRANSCRIBE_CONCURRENCY` | _TBD_ | 3 | Default setting validation |

---

## 2. Sarvam Speech-to-Text Batch Diarization (`tools/measure/sarvam-batch.js`)

Benchmark setup: 10-minute synthetic two-speaker audio consultation file. Full job cycle: job creation, upload, processing start, polling until completion, transcript download.

| Metric | Measured Value | Target / Budget | Notes |
|---|---|---|---|
| Upload Duration | _TBD_ | < 10 s | HTTPS upload to Sarvam storage |
| Queued / Processing Wait Time | _TBD_ | < 60 s | Time spent polling until `completed` |
| Total End-to-End Latency | _TBD_ | < 90 s | Complete turnaround time |
| Diarization Accuracy / Split | _TBD_ | 2 distinct speakers | Checks speaker channel separation |
| Suitable for Main Flow? | _TBD_ | Yes / No | If < 60s, may be considered as main pipeline |

---

## 3. Gemini Clinical Notes Drafting (`tools/measure/gemini-draft.js`)

Benchmark setup: ~5,000-word synthetic multi-turn bilingual/English consultation transcript with schema-enforced structured JSON output (doctor notes, patient summary, flagged clinical items with verified segment IDs).

| Metric | Measured Value | Target / Budget | Notes |
|---|---|---|---|
| Model Name | `gemini-1.5-flash` / `gemini-2.0-flash` | Configured model | Low-latency flash tier |
| Prompt Word Count | ~5,000 words | ~6,500 tokens | Realistic consultation length |
| First-Token Latency (TTFT) | _TBD_ | < 1,500 ms | Stream response start |
| Total Generation Latency | _TBD_ | < 8,000 ms | Must fit inside 1-2 min budget |
| Schema Conformity | _TBD_ | 100% | Valid JSON with all required fields |
| Segment Citations Present | _TBD_ | Yes | Every clinical claim cites `segment_id` |

---

## 4. Overall Pipeline Budget Evaluation

```
End-of-consultation
  │
  ├─ Final chunk upload & transcription flush:  ~ 15 - 20 s
  ├─ Segment merge & crosstalk deduplication:     < 1 s
  ├─ Tracer verification & data assembly:        < 1 s
  ├─ Gemini drafting (parallel note/summary):    ~ 5 - 10 s
  │
  ▼
Notes Ready for Clinician Review: Total ~ 25 - 35 s (Budget: < 120 s)
```
