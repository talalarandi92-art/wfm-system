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
- **B7 historical validation harness** ✅ built 2026-07-11, **RUN + corrected 2026-07-22** —
  `node scripts/scorecard-validate.js` over all 6 workbooks. Three harness defects fixed on the run:
  (1) classification used the GENERIC band, not the per-function band the scorer actually used
  (m089 overrides) — June formula-mismatch 14 → 1; (2) an engine `null` ("KPI not applicable to this
  function") was filed as *rounding* / *formula-mismatch* — new **`not-applicable`** class now
  isolates 110 such cells; (3) the gate was measured over rows the sheet itself contradicts.
  **Headline: 171 of 458 Final rows carry a HAND-TYPED score cell** (the workbook's cached value
  disagrees with its own formula), which no engine can reproduce — so the gate is now judged on the
  **287 formula-derivable rows** (raw all-rows figure 57.21% was measuring the typist).
  After D-079 landed the same day: **engine accuracy 92.33%** — Jan 98.78 · Feb 95.83 · Mar **100** ·
  Apr 100 · **May 39.29** · Jun 98.53, with the `rounding` variance class at ZERO in every month.
  Gate ≥98% NOT MET, and the entire remaining gap is MAY — the residue needs a Director ruling, not code
  (see “B7 findings” below). Report: `new folder/Scorecard 2026/Historical_Validation_Report.xlsx`.
- **B8 Sprinklr bridge queue-discovery repair** ⚠ needs extension repo location (parallel-safe).
- **B9 UI**: unified roster+daily-performance view, recon/unauthorized/survey/ranking/incentive pages (§25).
- **B10 ⭐ BUILDER v2 — Report Builder + Dashboard Builder + Filter Builder (PROMOTED, Director 2026-07-11 "لا تنسى الريبورت بلدر v2")** — the true Sprinklr-replacement surface. Base exists: `ReportBuilder.tsx` + `DashboardBuilder.tsx` + `roster-reports report-builder` endpoint. Grounded in the LIVE Sprinklr capture (docs/master/SPRINKLR_LIVE_REPORTING_FINDINGS.md) + the 9 screenshots. Parity targets: **tabbed sections per dashboard** · **metric/dimension LIBRARY picker** (screenshot 6) · **visual widget builder** (source→visualization→columns→add; screenshot 5) · **relative date controls** (Last month/28/30/60/90/120/180, This/Last Year, Lifetime, Dynamic, Custom; screenshot 7) · **filter builder** (Select Filter/Type/Value + per-widget filter badge; screenshot 2) · **calculated metrics** · per-widget granularity + chart-type toggle + column config · drill-down (every number → provenance, ties to R0 <Kpi>) · data-freshness · Excel export. Same-report-per-widget rule. DESIGN = original WFM (dazzle/ds kit), NOT a Sprinklr clone. Can start on EXISTING data (roster_days/scorecard_monthly/agent_daily_stats) and widen as B2-B7 + Auto-Ingest add sources — so it is NOT blocked; sequence it as its own sub-program in parallel once Auto-Ingest wave 1 lands (or immediately on current data if Director prioritizes).
- **B11 hardening**: DQ statuses, bridge-health, backfill UI, immutable audit, RBAC, docs.

Pure-backend: B0–B8 · UI: B9–B11 · credential-gated: B3/B4/B8.

## B7 findings — what stands between 92.33% and the gate (Director rulings, NOT code)

**F1 ✅ RESOLVED (D-079, Director 2026-07-22 — option (c) executed).** Round-half-up is now DISPLAY
ONLY; bands compare the raw %. The `rounding` variance class is ZERO in every month and engine
accuracy went 91.29% → **92.33%** (Mar 92% → 100%). Original finding kept below for the record.

**F1 (original) — a confirmed rule contradicted the workbooks.**
`WFM_RULES_AND_DECISIONS.md` §KPI says **round-half-up all %** *then* band it. Your SC sheets' own
formulas band the **RAW fraction**. They disagree on **71 cells**, and it is nearly one-directional:
**68 of 71 award MORE points than your sheet, +550 net points in total.** Examples: QA 94.75% → rule
30 pts / sheet 20 · QA 89.60% → rule 20 / sheet 10 · QA **79.80% → rule 10 / sheet −10** (a 20-point
swing at the band edge) · productivity 88.90% → rule 5 / sheet 0. Affected KPIs: PRODUCTIVITY 64,
QUALITY 7. **Nothing was changed** — flipping the comparison basis is a rule change (BR-APP-006).
Options were (a) keep the rule, (b) band raw everywhere, (c) round for display only + band raw.
**The Director chose (c) on 2026-07-22 and it is implemented.**

**F5 (new, needs a ruling) — the productivity band uses DISCRETE steps.** `=90` / `=89` only match
exact integer percentages, so a raw 88.90% matches no band and scores **0** — which is precisely what
your own sheet does (May CH-WA 88.90% was awarded 0 there), but it means a 90.5% performer scores 0
while a 90.0% performer scores 10. If that is not intended, the band needs RANGES (`≥90`, `≥89`)
instead of equalities. Nothing changed — this is a band-design question, not a rounding one.

**F2 May-26 `Internship Inbound` block (45 RT cells + 9 AHT).** m089 seeded that function from the
Jan+June MAJORITY (inbound band; RT not scored), and flagged May as an email-shaped outlier. May's
sheet does score its RT (15 pts). Ruling needed: was May's Internship-Inbound block deliberately
scored as email, or is the May sheet the outlier? This one block is most of May's 39.29%.

**F3 `Offline` / `Internship Offline` QUALITY (40 cells, May + Feb).** Your 2026-07-11 rule says
Offline QA is **not applicable**; the Feb and May sheets predate that rule and scored it (10 pts at
80%). Expected and harmless — confirm the rule applies **forward only** and these months stay as-is.

**F4 (context, no ruling) — 171/458 rows are partly hand-typed.** Mar 42 · Apr 46 · **May 75** rows
contain a score cell that contradicts the sheet's own formula, concentrated in CH-WA / Inbound
AHT+RT. That is *why* the raw match rate looked catastrophic. Worth knowing on its own: for those
three months, the official scores were partly manual, so no engine — ours or a rebuilt Excel — can
reproduce them exactly.

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
