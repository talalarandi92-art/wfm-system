# Roster Reconciliation — THE base pipeline (single source of truth)

> This is the **base process** for the corrected attendance/roster shown on the live **`/roster`** page.
> Whenever new monthly source files arrive, run ONE command and the page is refreshed with the validated
> reconciliation. Do **not** rebuild this from scratch — it already matches the manual work ~95–98%.

## What it does
`Foundation (your exact shift times) → corrected engine → ingest → live roster_days`. The engine reproduces the
team's manual method (Ameyo-first + earliest-login across both sources, midnight first-in/last-out, WFH = code/
location/Odoo-status, Odoo-absence→WFH-worked rescue, approved-permission-only, mother 7h, excluded supervisory
roles, OT ≤2h auto / >2h flagged, off-day/holiday OT, bleed guards). Validated vs the manual: late 96%, early 95%.

## Files (put them in `Desktop/new roster/`)
| File | Role |
|---|---|
| `CC Schedule 26 June..xlsx` (sheet **`Shifts.`**) | the FINAL long-form roster — **the authority** (codes + exact shift Start/End) |
| `Odoo Fingerprint June.xlsx` | biometric punches |
| `Permission & Compo June.xlsx` | permissions + comp |
| `Ameyo login and logout.xlsx` | Ameyo system sessions |
| `Login and Logout sprinklr.xlsx` | Sprinklr system sessions |

## Run
```bash
cd backend
node scripts/recon-refresh.js          # foundation → engine → ingest → LIVE
node scripts/recon-ingest.js --restore # revert roster_days to the first backup (roster_days_recon_bak)
```
Override the final file: `MANUAL_FILE="C:/path/to/CC Schedule.xlsx" node scripts/recon-refresh.js`.
The corrected Excel deliverables (16-sheet workbook, Manual_vs_Engine_Comparison, Odoo_Permission_Comp_Ready) are
also written to `Desktop/new roster/`.

## Scripts (all in `backend/scripts/`)
- `recon-refresh.js` — **the one command** (orchestrates the 3 below).
- `recon-extract-foundation-v2.js` — foundation from the final `Shifts.` sheet (exact times).
- `recon-new-roster.js` (+ `recon-build.js`) — the engine; writes the workbook + `ingest.json`.
- `recon-ingest.js` — backup + replace June in `roster_days` (DB creds from the project-root `.env`, `POSTGRES_*`).
- `recon-compare-manual.js` — diff vs the manual sheet (writes `Manual_vs_Engine_Comparison.xlsx`).

## From inside the system (no terminal)
The Roster page **"Upload & Rebuild"** button (green) runs this exact pipeline server-side:
`POST /attendance-recon/recon-refresh` (admin / `schedule.publish`). Drop the month's files in the picker — they're
matched by filename, saved into `Desktop/new roster/`, then foundation→engine→ingest runs and roster_days refreshes.
You can also run it with no files to just rebuild from whatever is already in the folder.

## Holidays (editable)
`scripts/recon-config.json` → `holidays: [{date, name}]`. Anyone who works a SCHEDULED shift on a holiday date gets
the WHOLE shift credited as **holiday OT** and the row is labelled "Official Holiday — <name>". Edit + re-run.

## Every rule lives in the engine (why it stops regressing)
`recon-build.js` writes the **master HR code** (`hr_code` SL/A/L/H/OFF/WFH/shift + `attendance_code`) that the HR
Matrix reads via `COALESCE(hr_code, attendance_code, shift_code,'OFF')`. Because these are computed in the engine,
**every refresh re-applies them** — a re-ingest can no longer wipe SL/absence/leave/holiday semantics. If a report
ever looks wrong after a refresh, the rule belongs in `recon-build.js`, not patched into the data.

## Notes / open items
- **June only** so far (the new files are June). For other months, drop those months' files and re-run.
- **Off-day OT** is the one less-certain field (system-only, no schedule anchor; bleed-guarded). Verify before trusting.
- Safe + reversible: every ingest is one transaction; the **first** snapshot is kept in `roster_days_recon_bak`.
- Times display **12-hour AM/PM**; durations stay HH:MM:SS.
