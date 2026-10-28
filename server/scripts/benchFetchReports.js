/**
 * Downloads recent lab-report files for the OCR benchmark (ocr/bench/).
 *
 * Read-only: it lists lab_reports and downloads their files from Storage; it
 * writes nothing to the database. Files are named <report id><ext> so the
 * benchmark output can be traced back to the stored report. The target folder
 * is git-ignored because these are real patients' reports.
 *
 *   node scripts/benchFetchReports.js [--limit 10] [--out ../ocr/bench/reports]
 */
const fs = require('fs');
const path = require('path');
const supabaseAdmin = require('../src/config/supabaseAdminClient');
const { LAB_REPORTS_BUCKET } = require('../src/services/storage.service');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const limit = Number(arg('limit', 10));
  const outDir = path.resolve(arg('out', path.join(__dirname, '../../ocr/bench/reports')));
  fs.mkdirSync(outDir, { recursive: true });

  const { data: reports, error } = await supabaseAdmin
    .from('lab_reports')
    .select('id, storage_path, uploaded_at')
    .not('storage_path', 'is', null)
    .order('uploaded_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  let saved = 0;
  for (const report of reports) {
    const { data: blob, error: downloadError } = await supabaseAdmin.storage
      .from(LAB_REPORTS_BUCKET)
      .download(report.storage_path);
    if (downloadError) {
      console.error(`skip ${report.id}: ${downloadError.message}`);
      continue;
    }
    const file = path.join(outDir, `${report.id}${path.extname(report.storage_path) || '.bin'}`);
    fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    saved += 1;
    console.log(`saved ${path.basename(file)} (${report.uploaded_at})`);
  }
  console.log(`${saved} of ${reports.length} report files in ${outDir}`);
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
