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
  step('recon-extract-foundation-v2.js', '1/3  foundation from your final "Shifts." sheet (exact shift times)');
  step('recon-new-roster.js', '2/3  corrected reconciliation engine → ingest payload');
  step('recon-ingest.js', '3/3  ingest → LIVE roster_days (backed up first)');
  console.log('\n✅ DONE in ' + ((Date.now() - t0) / 1000).toFixed(0) + 's — /roster now shows the corrected reconciliation. Restore: node scripts/recon-ingest.js --restore');
} catch (e) {
  console.log('\n❌ REFRESH FAILED at a step above. roster_days is unchanged unless the ingest step printed INGEST OK. ' + (e.message || ''));
  process.exit(1);
}
