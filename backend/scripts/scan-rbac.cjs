#!/usr/bin/env node
/**
 * RBAC GATE AUDIT — every HTTP route must carry an explicit access decision.
 *
 * The platform is deny-by-default (P1.2). This script proves it stays that way:
 * it walks every *.controller.ts and reports any handler that carries NO gate.
 *
 * Three gates count as an explicit decision, and all three are deliberate:
 *   @RequirePermissions(...)  a named permission (class-level covers its routes)
 *   @AuthOnly()               any authenticated user — reference lookups, /me
 *   @Public()                 deliberately open — login, token refresh
 *
 * Why this rewrite: the previous version knew only the first and the third, so it
 * reported 8 phantom holes — all of them `@AuthOnly()`. A security check that
 * cries wolf gets ignored, and worse, a genuine 9th hole would have read as more
 * of the same noise. It now recognises every gate and EXITS NON-ZERO on a real
 * finding, so it can be trusted as a gate rather than read as a list.
 *
 *   node scripts/scan-rbac.cjs           # summary; exit 1 if anything is ungated
 *   node scripts/scan-rbac.cjs --list    # also print the per-controller table
 */
const fs = require('fs');
const path = require('path');

const VERBOSE = process.argv.includes('--list');
const ROOT = 'src';

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.controller.ts')) files.push(p);
  }
})(ROOT);

const HTTP = /@(Get|Post|Put|Patch|Delete)\s*\(/;
const GATE = /@(RequirePermissions|AuthOnly|Public)\s*\(/;

const rows = [];
let totalRoutes = 0;
const holes = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  // A class-level gate covers every route in the controller.
  const clsIdx = lines.findIndex((l) => /export class \w+/.test(l));
  const header = lines.slice(0, clsIdx < 0 ? 0 : clsIdx).join('\n');
  const classGated = GATE.test(header);

  /* Walk handler by handler instead of counting decorators file-wide: counting
     cannot tell WHICH route is missing a gate, and a miscount silently hides one. */
  let routes = 0;
  const ungatedHere = [];
  for (let i = 0; i < lines.length; i++) {
    if (!HTTP.test(lines[i])) continue;
    routes++;
    if (classGated) continue;
    // Look back over this handler's own decorator block (stop at the previous
    // handler / a blank-line gap of 2, whichever comes first).
    let gated = false;
    for (let j = i - 1; j >= 0 && i - j <= 12; j--) {
      const l = lines[j];
      if (GATE.test(l)) { gated = true; break; }
      if (/^\s*}/.test(l)) break;            // previous handler's body ended
    }
    // A gate can also sit directly BELOW the verb decorator.
    if (!gated) {
      for (let j = i + 1; j < lines.length && j - i <= 6; j++) {
        const l = lines[j];
        if (GATE.test(l)) { gated = true; break; }
        if (/async |\(\s*$|^\s*[a-zA-Z_]\w*\s*\(/.test(l) && !/^\s*@/.test(l)) break;
      }
    }
    if (!gated) {
      const route = (lines[i].match(/@(\w+)\s*\(\s*['"`]?([^'"`)]*)/) || []);
      ungatedHere.push({ line: i + 1, verb: route[1] ?? '?', pathPart: route[2] ?? '' });
    }
  }

  totalRoutes += routes;
  const short = file.split(path.sep).join('/').replace('src/modules/', '').replace('src/', '');
  rows.push({ file: short, routes, classGated, ungated: ungatedHere.length });
  for (const u of ungatedHere) holes.push({ file: short, ...u });
}

if (VERBOSE) {
  rows.sort((a, b) => b.ungated - a.ungated || a.file.localeCompare(b.file));
  for (const r of rows) {
    console.log(
      String(r.ungated).padStart(3) + ' ungated / ' + String(r.routes).padStart(3) + ' routes  ' +
      (r.classGated ? '[class-gated] ' : '              ') + r.file,
    );
  }
  console.log('');
}

console.log(`RBAC gate audit — ${totalRoutes} routes across ${files.length} controllers`);
console.log(`gates recognised: @RequirePermissions · @AuthOnly · @Public`);

if (!holes.length) {
  console.log('\n✅ every route carries an explicit access decision.');
  process.exit(0);
}

console.log(`\n❌ ${holes.length} route(s) carry NO gate — deny-by-default is broken:\n`);
for (const h of holes) console.log(`   ${h.file}:${h.line}  @${h.verb}('${h.pathPart}')`);
console.log('\nAdd @RequirePermissions(...), @AuthOnly() or @Public() — an omission is not a decision.');
process.exit(1);
