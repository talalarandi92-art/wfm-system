# SCORECARD/KPI/BRIDGES PROGRAM — wave plan

> **Source of truth: `new folder/FINAL_MASTER_WFM_SCORECARD_KPI_BRIDGES_REPORT_DASHBOARD_WITH_VISUAL_REFERENCES.md`**
> (Director, 2026-07-11; 28 sections + KPI clarifications + builders + bridge repair) with 9 visual
> references + `Loginlogout Sprinklir Reports API.txt` (SERVICE_ANALYTICS `USER_AVAILABILITY_SLA_REPORT_V2`
> request body — proves server-side pulls; auth key + X-PARTNER-ID still needed) + `Scorecard 2026/`
> (Jan–Jun SC workbooks) + `Overtime 2026/` (11 OT workbooks — separate reconciliation track).
> Status: audit done 2026-07-11; B1 in flight. Non-Negotiable Rule honored: every wave implements+tests, never docs-only.

## Head start (audit verdict)
The `scorecard-builder` skill + `scorecard-audit.js` ALREADY encode the §17 reverse-engineering
(bands, productivity IF, source map, rounding, quiz/maternity). §1–3, 17 = largely EXISTS as skill
knowledge → promote to DB, don't redo. Sprinklr ingest/identity/odoo-bridge/recon/report-builder all
PARTIAL (solid bases). NEW: KPI registry, explainability records, tri-source recon statuses,
unauthorized-record table, ~60-col daily performance record, auto-scoring from live data.

## Waves
- **B0 audit** ✅ 2026-07-11 (session agent) — remaining tail: locate the Sprinklr extension repo (not in backend/).
- **B1 KPI Registry + rulebook DB** ✅ ef23877 (m080) — kpi_registry + kpi_function_config (most-specific-wins) +
  scorecard_formula_versions (append-only trigger). 13 KPIs seeded from the skill; 16 specs incl. SQL↔TS parity;
  additive (nothing reads it yet — B6 consumes it). 6 honest gaps flagged IN-DB: AHT per-function bands, QUIZ-95
  boundary (IF wins over prose), QA bar 0.80/0.95, PRR denominator (spec Yes÷Contacts vs rules Yes÷responses),
  CSAT/NPS no bands, weights all 1. **Director inputs needed later**: confirm PRR denominator + QUIZ-95 + QA bar.
- **B2 identity formalization** — employee_identity linking Odoo↔WFM↔Sprinklr + unresolved queue + transfer history.
- **B3 Sprinklr report-API connectors** ⚠ NEEDS key+X-PARTNER-ID from Director — server-side login/logout
  (USER_AVAILABILITY_SLA_REPORT_V2), agent perf, survey; staging + refresh ledger.
- **B4 Odoo fingerprint (hr.attendance) + request propagation** ⚠ needs Odoo scope decision.
- **B5 tri-source reconciliation + authorized/unauthorized engine** (8 statuses; adherence vs conformance versioned).
- **B6 daily performance record + auto daily/weekly/monthly scoring** + explainability + publish/freeze.
- **B7 historical validation harness** — system-vs-Excel over the 6 workbooks (Jan–Apr mandatory, May–Jun bonus);
  variance classification; accuracy gate before auto-scoring activation.
- **B8 Sprinklr bridge queue-discovery repair** ⚠ needs extension repo location (parallel-safe).
- **B9 UI**: unified roster+daily-performance view, recon/unauthorized/survey/ranking/incentive pages (§25).
- **B10 Report Builder + Dashboard Builder extension + improvement engine** (screenshots are the reference; original WFM design).
- **B11 hardening**: DQ statuses, bridge-health, backfill UI, immutable audit, RBAC, docs.

Pure-backend: B0–B8 · UI: B9–B11 · credential-gated: B3/B4/B8.

## Open questions for the Director (blocking marked)
1. ⚠ Sprinklr reporting-API **key + X-PARTNER-ID + base URL** (blocks B3; the txt is only a request body).
2. ⚠ Sprinklr **extension repo location** (blocks B8).
3. ⚠ Odoo **hr.attendance** API scope, or stay bridge-staged? (B4)
4. Survey attribution = Agent Email + Channel (screenshot 9) — confirm resolving-agent model.
5. CTR direction: Contacts÷Tickets per spec — confirm over any historical Tickets÷Contacts sheet.
6. Productivity: keep the skill's exact IF (incl. sick>2 quirk) active; redesign only after simulation?
7. Validation months: include May+Jun (all 6) in the B7 gate?
8. Accuracy threshold to activate auto-scoring (suggest ≥98% net-points match per function).
9. AHT bands: revise to function-specific seconds once B3 lands?
10. OT workbooks: separate reconciliation track (June recon running) — confirm out of scorecard critical path.
