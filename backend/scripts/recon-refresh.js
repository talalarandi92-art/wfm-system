/**
 * ============================================================================
 *  RECON REFRESH  —  ONE command to rebuild the corrected roster and push it LIVE.
 * ============================================================================
 *  THE BASE PROCESS. Run this whenever new source files arrive, and the /roster
 *  page (roster_days) is refreshed with the validated reconciliation.
 *
 *  WHERE TO PUT THE FILES (folder:  Desktop/new roster/):
 *    • CC Schedule 26 June..xlsx        — your FINAL long-form roster (sheet "Shifts.")  ← the authority
 *    • Odoo Fingerprint June.xlsx       — biometric punches
 *    • Permission & Compo June.xlsx     — permissions + comp
 *    • Ameyo login and logout.xlsx      — Ameyo system sessions
 *    • Login and Logout sprinklr.xlsx   — Sprinklr system sessions
 *  (override the final-file path with  MANUAL_FILE=...  ; the others are read from the same folder.)
 *
 *  RUN:      node scripts/recon-refresh.js
 *  RESTORE:  node scripts/recon-ingest.js --restore     (reverts roster_days to the first backup)
 *
 *  PIPELINE:  foundation v2 (your exact shift times)  →  corrected engine  →  ingest → live roster_days.
 *
 *  AUTO-INGEST (opt-in, default OFF — 2026-07-11):  the recon SOURCE files can be
 *  produced from LIVE captured staging instead of manual uploads:
 *    AUTO_INGEST_SPRINKLR=1  → emit "Login and Logout sprinklr.xlsx" from sprinklr_report_staging
 *    AUTO_INGEST_ODOO=1      → emit "Odoo Fingerprint June.xlsx" + "Permission & Compo June.xlsx" from odoo_staging
 *  These run BEFORE recon-new-roster, overwriting the corresponding source file.
 *  When unset (default) the pipeline is EXACTLY as before — it reads the manual files.
 *  (Emitters are empty-safe: no live capture yet → header-only file, run continues.)
 * ============================================================================
 */
const { execSync } = require('child_process');
const path = require('path');
const dir = __dirname;
const step = (script, label) => {
  console.log('\n▶ ' + label + '  (' + script + ')');
  execSync('node --max-old-space-size=4096 "' + path.join(dir, script) + '"', { stdio: 'inherit', env: process.env });
};

console.log('=== RECON REFRESH — rebuild the corrected roster + push it LIVE ===');
const t0 = Date.now();
try {
  step('recon-extract-foundation-v2.js', '1/4  foundation from your final "Shifts." sheet (exact shift times)');
  // Evidence carry-forward (2026-07-06): dump per-day WFH location evidence from the LIVE
  // roster BEFORE the rebuild — later sheet re-exports flattened the Location column to
  // "Office", so without this every historical WFH day would misclassify as Office.
  step('recon-export-wfh-evidence.js', '1.5  carry forward per-day WFH evidence from live roster_days');
  // Optional AUTO-INGEST emitters (default OFF) — produce recon source files from live staging.
  if (process.env.AUTO_INGEST_SPRINKLR === '1') {
    step('recon-emit-sprinklr-sessions.js', '1.6  AUTO-INGEST: emit Sprinklr sessions ← sprinklr_report_staging');
  }
  if (process.env.AUTO_INGEST_ODOO === '1') {
    step('recon-emit-odoo-fingerprint.js', '1.7  AUTO-INGEST: emit Odoo fingerprint ← odoo_staging (hr.attendance)');
    step('recon-emit-odoo-permissions.js', '1.8  AUTO-INGEST: emit Odoo permission/comp ← odoo_staging');
  }
  step('recon-new-roster.js', '2/4  corrected reconciliation engine → ingest payload');
  step('recon-ingest.js', '3/4  ingest → LIVE roster_days (backed up first)');
  // Step 4 (2026-07-06, one-spine fix): resync attendance_records from the canonical
  // roster_days for the ingested range, so dashboard/RTA/scorecard/coverage (the raw-spine
  // readers) show the SAME OT/late/presence as the roster pages. Generated future weeks
  // ('[generated %' notes) are preserved. APPLY=1 = the pipeline just ingested, write for real.
  process.env.APPLY = '1';
  step('recon-sync-attendance.js', '4/4  resync attendance_records ← roster_days (one spine)');
  // GATE (2026-07-06, risk #9): the golden master asserts the pay rules on the SHIPPED data
  // (classifyCode dictionary + pickWindow bleed + live clamps). A refresh that violates a pay
  // invariant FAILS the pipeline — restore with: node scripts/recon-ingest.js --restore
  step('recon-golden.test.cjs', 'GATE  golden-master pay-rule check');
  console.log('\n✅ DONE in ' + ((Date.now() - t0) / 1000).toFixed(0) + 's — /roster now shows the corrected reconciliation. Restore: node scripts/recon-ingest.js --restore');
} catch (e) {
  console.log('\n❌ REFRESH FAILED at a step above. roster_days is unchanged unless the ingest step printed INGEST OK. ' + (e.message || ''));
  process.exit(1);
}
