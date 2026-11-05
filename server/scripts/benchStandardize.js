/**
 * Scores OCR benchmark runs (ocr/bench/) with the app's real rules.
 *
 * Each engine's rows go through standardizeMetrics() — the same dictionary
 * matching, unit conversion and 85% review rule production uses — and the
 * review reason comes from the client's own reviewReason(). Reads the metric
 * dictionary from the database; writes nothing there. Prints Markdown.
 *
 *   node scripts/benchStandardize.js ../ocr/bench/out/current.json ../ocr/bench/out/docling.json \
 *     [--truth ../ocr/bench/out/ground_truth.csv] > ../ocr/bench/out/report.md
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { standardizeMetrics } = require('../src/services/standardization/standardizeLabReport.service');

const RANGE = /^\s*[<>≤≥]?\s*\d[\d,.]*\s*[-–]\s*\d[\d,.]*\s*$/;

function parseArgs(argv) {
  const runs = [];
  let truth = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--truth') truth = argv[++i];
    else runs.push(argv[i]);
  }
  return { runs, truth };
}

/** Minimal CSV reader: quoted fields, commas and doubled quotes inside quotes. */
function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const keyOf = (m) => m.standard_key ?? `raw:${String(m.raw_key ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;

function sameValue(a, b) {
  const na = a.parsed_value;
  const nb = b.parsed_value;
  if (na != null && nb != null) {
    const x = Number(na);
    const y = Number(nb);
    return x === y || Math.abs(x - y) <= 0.005 * Math.max(Math.abs(x), Math.abs(y));
  }
  return String(a.raw_value ?? '').trim().toLowerCase() === String(b.raw_value ?? '').trim().toLowerCase();
}

async function standardizeFile(file) {
  const rows = await standardizeMetrics(
    (file.metrics || []).map((m) => ({
      key: m.key,
      value: m.value,
      unit: m.unit || undefined,
      confidence: typeof m.confidence === 'number' ? m.confidence : undefined,
    }))
  );
  return rows;
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

async function main() {
  const { runs, truth } = parseArgs(process.argv.slice(2));
  if (runs.length === 0) {
    console.error('Usage: node scripts/benchStandardize.js run1.json [run2.json ...] [--truth ground_truth.csv]');
    return 1;
  }
  const { reviewReason } = await import(pathToFileURL(path.join(__dirname, '../../client/src/utils/flowsheet.js')).href);

  // Ground truth, standardised the same way (hand-checked, so full confidence).
  let truthByFile = null;
  if (truth) {
    truthByFile = new Map();
    const byFile = new Map();
    for (const r of readCsv(truth)) {
      if (!r.file || !r.test) continue;
      if (!byFile.has(r.file)) byFile.set(r.file, []);
      byFile.get(r.file).push({ key: r.test, value: r.value, unit: r.unit || undefined, confidence: 1 });
    }
    for (const [file, metrics] of byFile) truthByFile.set(file, await standardizeMetrics(metrics));
  }

  const engines = [];
  for (const runPath of runs) {
    const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
    const files = [];
    for (const file of run.files) {
      const rows = await standardizeFile(file);
      const flagged = rows.filter((r) => r.needs_review);
      const reasons = {};
      for (const r of flagged) {
        const reason = reviewReason(r).replace(/"[^"]*"/g, '"…"').replace(/\(.*\)/, '(…)');
        reasons[reason] = (reasons[reason] || 0) + 1;
      }
      let correct = null;
      if (truthByFile?.has(file.file)) {
        const expected = new Map(truthByFile.get(file.file).map((t) => [keyOf(t), t]));
        // Each printed value counts once, even if a page was photographed twice.
        correct = new Set(
          rows.filter((r) => expected.has(keyOf(r)) && sameValue(r, expected.get(keyOf(r)))).map(keyOf)
        ).size;
      }
      files.push({
        name: file.file,
        engine: file.engine,
        pages: file.pages || 0,
        seconds: file.seconds,
        error: file.error,
        rows,
        count: rows.length,
        matched: rows.filter((r) => r.standard_key).length,
        flagged: flagged.length,
        reasons,
        rangeAsValue: rows.filter((r) => RANGE.test(String(r.raw_value ?? ''))).length,
        correct,
        expected: truthByFile?.get(file.file)?.length ?? null,
      });
    }
    engines.push({ name: run.engine, load: run.load_seconds, files });
  }

  const sum = (e, k) => e.files.reduce((n, f) => n + (f[k] ?? 0), 0);
  const out = [];
  out.push('# OCR benchmark', '');
  out.push(`${engines[0].files.length} report file(s). Rows scored with the app's own standardisation and review rules.`, '');
  const header = ['', ...engines.map((e) => e.name)];
  const table = [
    ['Values read', ...engines.map((e) => sum(e, 'count'))],
    ['Matched to the dictionary', ...engines.map((e) => `${sum(e, 'matched')} (${pct(sum(e, 'matched'), sum(e, 'count'))})`)],
    ['Flagged for review', ...engines.map((e) => sum(e, 'flagged'))],
    ['Range read as the value', ...engines.map((e) => sum(e, 'rangeAsValue'))],
  ];
  if (truthByFile) {
    const expected = [...truthByFile.values()].reduce((n, rows) => n + rows.length, 0);
    table.push(['Correct rows (vs ground truth)', ...engines.map((e) => `${sum(e, 'correct')} of ${expected} (${pct(sum(e, 'correct'), expected)} recall)`)]);
    table.push(['Precision', ...engines.map((e) => pct(sum(e, 'correct'), sum(e, 'count')))]);
  }
  const perPage = engines.map((e) => median(e.files.filter((f) => f.pages).map((f) => f.seconds / f.pages)));
  table.push(['Median seconds per page', ...perPage.map((v) => (v == null ? '—' : v.toFixed(1)))]);
  // Digital PDFs and scans cost very different amounts; the first run's
  // routing says which is which (the same files go through every engine).
  const kind = new Map(engines[0].files.map((f) => [f.name, f.engine === 'ocr' ? 'scan' : 'digital']));
  for (const [label, k] of [['Seconds per page, digital PDFs', 'digital'], ['Seconds per page, scans/photos', 'scan']]) {
    const values = engines.map((e) => {
      const fs_ = e.files.filter((f) => kind.get(f.name) === k && f.pages);
      const pages = fs_.reduce((n, f) => n + f.pages, 0);
      return pages ? (fs_.reduce((n, f) => n + f.seconds, 0) / pages).toFixed(1) : '—';
    });
    table.push([label, ...values]);
  }
  table.push(['Model load (one-off, s)', ...engines.map((e) => e.load ?? '—')]);
  table.push(['Files that failed', ...engines.map((e) => e.files.filter((f) => f.error).length)]);
  out.push(`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`);
  for (const row of table) out.push(`| ${row.join(' | ')} |`);
  out.push('');

  // Decision, per the plan: more correct rows (or, without truth, fewer range-as-value and flags) at <= ~2x the time.
  if (engines.length >= 2) {
    const [base, cand] = engines;
    const speedOk = perPage[0] && perPage[1] ? perPage[1] <= 2 * perPage[0] : true;
    const better = truthByFile
      ? sum(cand, 'correct') > sum(base, 'correct')
      : sum(cand, 'rangeAsValue') < sum(base, 'rangeAsValue') && sum(cand, 'flagged') <= sum(base, 'flagged');
    // Without ground truth the two signals can point different ways; say so rather than pick one.
    const mixed =
      !truthByFile &&
      !better &&
      (sum(cand, 'rangeAsValue') < sum(base, 'rangeAsValue') || sum(cand, 'count') > sum(base, 'count'));
    out.push('## Decision', '');
    out.push(
      mixed
        ? `**Mixed — needs ground truth.** ${cand.name} read ${sum(cand, 'count')} values vs ${sum(base, 'count')} and ${sum(cand, 'rangeAsValue')} ranges as values vs ${sum(base, 'rangeAsValue')}, but ${sum(cand, 'flagged')} were flagged vs ${sum(base, 'flagged')}, at ${perPage[1]?.toFixed(1)}s vs ${perPage[0]?.toFixed(1)}s per page${speedOk ? '' : ' (over 2× slower)'}.`
        : better && speedOk
        ? `**${cand.name} wins**: ${truthByFile ? 'more correct rows' : 'fewer ranges read as values and no more flags'}, at ${perPage[1]?.toFixed(1)}s vs ${perPage[0]?.toFixed(1)}s per page.`
        : `**Stay on ${base.name}.** ${cand.name} ${better ? `is more accurate but too slow (${perPage[1]?.toFixed(1)}s vs ${perPage[0]?.toFixed(1)}s per page, over 2×)` : 'is not more accurate on these reports'}.`
    );
    if (!truthByFile) out.push('', '_No ground truth given: accuracy is judged from ranges-read-as-values and review flags only. Add `--truth` for a firm answer._');
    out.push('');
  }

  // Flag reasons per engine.
  out.push('## Why values were flagged', '');
  for (const e of engines) {
    const reasons = {};
    for (const f of e.files) for (const [r, n] of Object.entries(f.reasons)) reasons[r] = (reasons[r] || 0) + n;
    out.push(`**${e.name}**`, '');
    const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
    out.push(...(entries.length ? entries.map(([r, n]) => `- ${n} × ${r}`) : ['- none']), '');
  }

  // Per file: where the engines disagree.
  if (engines.length >= 2) {
    out.push('## Where the engines disagree', '');
    for (const file of engines[0].files) {
      const others = engines.slice(1).map((e) => e.files.find((f) => f.name === file.name));
      const maps = [file, ...others].map((f) => new Map((f?.rows || []).map((r) => [keyOf(r), r])));
      const keys = [...new Set(maps.flatMap((m) => [...m.keys()]))];
      const truthMap = truthByFile?.get(file.name) ? new Map(truthByFile.get(file.name).map((t) => [keyOf(t), t])) : null;
      const diff = keys.filter((k) => {
        const vals = maps.map((m) => m.get(k));
        return vals.some((v) => !v) || vals.some((v) => v && vals[0] && !sameValue(v, vals[0])) || vals.some((v) => v?.needs_review);
      });
      out.push(`### ${file.name} (${file.pages || '?'} page${file.pages === 1 ? '' : 's'})`, '');
      if (diff.length === 0) { out.push('Both engines agree on every value.', ''); continue; }
      const cols = ['Test', ...engines.map((e) => e.name), ...(truthMap ? ['Ground truth'] : [])];
      out.push(`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`);
      const show = (r) => (r ? `${r.raw_value ?? '—'}${r.unit_raw ? ` ${r.unit_raw}` : ''}${r.needs_review ? ' ⚑' : ''}` : '—');
      for (const k of diff) {
        const label = maps.map((m) => m.get(k)).find(Boolean);
        const name = label?.standard_key ?? label?.raw_key ?? k;
        out.push(`| ${name} | ${maps.map((m) => show(m.get(k))).join(' | ')}${truthMap ? ` | ${show(truthMap.get(k))}` : ''} |`);
      }
      out.push('');
    }
    out.push('⚑ = would be flagged for the doctor to review.');
  }

  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

main()
  .then((code) => {
    // exitCode, not exit(): exiting while supabase-js handles close trips a libuv assertion on Windows.
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('Failed:', err.message || err);
    process.exitCode = 1;
  });
