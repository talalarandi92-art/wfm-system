/**
 * VERIFY-ALL — the one pre-ship gate (EXECUTION_BRIEF Phase-4 CI item).
 * Runs, in order, and FAILS on the first broken step:
 *   1. backend type-check   (npx tsc --noEmit)
 *   2. frontend type-check  (npx tsc --noEmit in ../frontend)
 *   3. golden-master pay-rule suite vs the LIVE DB (recon-golden.test.cjs)
 * Usage:  node scripts/verify-all.cjs        (or: npm run verify)
 * Skip the DB gate on a box without the live DB:  SKIP_GOLDEN=1 npm run verify
 */
const { execSync } = require('child_process');
const path = require('path');
const BE = path.join(__dirname, '..');
const FE = path.join(BE, '..', 'frontend');

const step = (label, cmd, cwd) => {
  process.stdout.write(`\n▶ ${label}\n`);
  const t = Date.now();
  execSync(cmd, { stdio: 'inherit', cwd });
  console.log(`  ✓ ${label} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
};

try {
  step('backend type-check', 'npx tsc --noEmit', BE);
  step('frontend type-check', 'npx tsc --noEmit', FE);
  if (process.env.SKIP_GOLDEN === '1') console.log('\n▶ golden master — SKIPPED (SKIP_GOLDEN=1)');
  else step('golden-master pay rules (live DB)', 'node scripts/recon-golden.test.cjs', BE);
  console.log('\n✅ VERIFY-ALL PASS — safe to ship.');
} catch (e) {
  console.error('\n❌ VERIFY-ALL FAILED at the step above — do not ship.');
  process.exit(1);
}
