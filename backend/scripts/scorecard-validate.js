#!/usr/bin/env node
/**
 * Wave B7 — Historical Validation Harness runner (spec §17-18).
 *
 * Re-scores the Director's 6 real SC workbooks (Jan..June 2026) through the
 * committed kpi-registry engine and writes
 * `new folder/Scorecard 2026/Historical_Validation_Report.xlsx`.
 *
 * Usage:  node scripts/scorecard-validate.js
 * Read-only on the source workbooks; touches no database.
 */
const path = require('path');
const fs = require('fs');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true },
});

const { runValidation, writeReport, NET_GATE_PCT } = require('../src/modules/scorecard-validation/run-validation');

const DIR = path.resolve(__dirname, '..', '..', 'new folder', 'Scorecard 2026');
const FILES = [
  '1.Jan 26 SC..xlsx',
  '2.Feb 26 SC..xlsx',
  '3.Mar 26 SC..xlsx',
  '4.April 26 SC..xlsx',
  '5.May 26 SC..xlsx',
  '6.June 26 SC..xlsx',
].map((f) => path.join(DIR, f));

const missing = FILES.filter((f) => !fs.existsSync(f));
if (missing.length) {
  console.error('Missing workbooks:\n  ' + missing.join('\n  '));
  process.exit(1);
}

console.log('Wave B7 — Historical Validation Harness');
console.log('Re-scoring 6 SC workbooks through the committed kpi-registry engine (m080+m088 seed)…\n');

const result = runValidation(FILES);

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('Month', 10) + pad('Emp', 5) + pad('Final', 7) + pad('Net=% ', 8) + pad('avg|Δ|', 8) + pad('Net=% exclAHT/RT', 18) + pad('Cell=%', 8) + pad('Rank=%', 8) + 'Variances (rnd/bnd/frm/data/manual)');
for (const m of result.months) {
  const v = m.varianceCounts;
  console.log(
    pad(m.month, 10) + pad(m.employees, 5) + pad(m.finalRowsCompared, 7) +
    pad(m.netExactMatchPct, 8) + pad(m.avgAbsNetDiff, 8) + pad(m.netExactMatchPctExclKnown, 18) +
    pad(m.cellExactMatchPct, 8) + pad(m.rankExactMatchPct, 8) +
    `${v.rounding}/${v.boundary}/${v['formula-mismatch']}/${v.data}/${v['manual-override']}`,
  );
  if (m.skipped.length) console.log('   SKIPPED: ' + m.skipped.slice(0, 5).join(' | ') + (m.skipped.length > 5 ? ` (+${m.skipped.length - 5} more)` : ''));
}
console.log('\nOVERALL (Final rows): net exact-match ' + result.overall.netExactMatchPct + '% | avg |net diff| ' + result.overall.avgAbsNetDiff +
  ' | excl known AHT/RT simplification: ' + result.overall.netExactMatchPctExclKnown + '%');
console.log('Suggested >=' + NET_GATE_PCT + '% net-points gate: ' + (result.overall.gateMet ? 'MET' : 'NOT MET') +
  ' (descriptive only — auto-scoring activation stays the Director\'s call)');

const out = path.join(DIR, 'Historical_Validation_Report.xlsx');
writeReport(result, out);
console.log('\nReport written: ' + out);
