# Module 02 — Attendance & Adherence (Fingerprint vs System)
**Boutiqaat Contact Center Transformation** · Owner: WFM · Status: Design for build · **Phase 1 (critical path)**

---

## 1. Purpose
Reconcile **three time sources** — schedule, fingerprint (physical), system login/Sprinklr state — into one trusted attendance + adherence fact. Feeds lateness, early-out, fingerprint-vs-system, adherence reports, and the headcount engine.

**Governance rule (locked):** **System login/state drives coverage & adherence. Fingerprint drives payroll & physical presence.**

---

## 2. Scope
Presence · late · early-out · missing punch · missing login/logout · overstay · cross-midnight · productive hours · adherence % · exempt time.

---

## 3. Data per agent-day → `FACT_Attendance`
Schedule: shift code, start, end, cross-midnight, split-shift segments.
Fingerprint: in, out.
System: login, logout, active minutes, **exempt minutes**.
Derived: FP/system late, FP/system early-out, productive, adherence %, status, repeated count, coaching flag.

---

## 4. Reconciliation workflow
```
Import schedule + fingerprint + system log (+ Sprinklr/Ameyo state)
→ Align each agent-day to scheduled shift (handle cross-midnight + split shift)
→ FP_Late = max(0, FingerprintIn − SchedStart) ; Sys_Late = max(0, SystemLogin − SchedStart)
→ Final Late = max(FP_Late, Sys_Late)
→ FP_EarlyOut / Sys_EarlyOut → Final EarlyOut = max of the two
→ Flag mismatch type (see §5)
→ Productive = SystemActive − ApprovedBreak − Exempt
→ Adherence % = (SchedProductive − Exempt − NonAdherence) / (SchedProductive − Exempt)
→ WFM reviews exceptions → fixes raised via Request Management (Attendance correction)
→ Lateness / Early-out / FP-vs-System / Adherence reports + dashboards refresh
```

---

## 5. Mismatch flags (auto-detected)
- Fingerprint exists, no system login
- System login exists, no fingerprint
- Fingerprint on time, system login late (and reverse)
- Early fingerprint-out while still logged in
- Early system logout while still fingerprinted
- Missing logout / missing punch
- Overstay / OT without approval
- Cross-midnight shift mis-alignment

→ Each flag = an exception row for WFM; correction goes through the audited Attendance-correction request.

---

## 6. Adherence logic
- Non-adherence = unapproved late + unapproved early-out + over-break + unexplained gaps.
- **Exempt time is excluded** (training, meeting, coaching, 1:1, **system/Sprinklr/CRM downtime**). Outage feed auto-marks downtime so agents are not penalised. *(Fairness — non-negotiable.)*
- Target band: **85–90%**.
- Repeated issue (≥ 3 in 30 days) → coaching flag → Module 05.

---

## 7. Automation
Auto-import + auto-reconcile daily · auto-flag the §5 mismatches · auto-exclude outage/system-down from non-adherence · auto-flag repeated late/early · auto-compute productive + adherence.

## 8. AI
Attendance **anomaly / fraud detection** (fingerprint without login, copy-punch patterns) · suspicious FP-vs-login mismatch · agent attendance-pattern detection.
```
AI scans attendance → flags improbable patterns → WFM reviews → confirm / dismiss (logged)
```

---

## 9. Reports this module feeds
Lateness (5) · Early-Out (6) · Fingerprint-vs-System (7) · Attendance & Adherence (9) — all designed in the WFM Control Workbook (`FACT_Attendance`).

## 10. Build status
**Ready:** `attendance_records` holds fingerprint + system login/logout + late/early minutes + OT (data exists). Late/early-out reports live.
**To build:** full reconciliation engine, adherence % with exempt time, outage→exempt linkage, anomaly detection.

## 11. Governance
Source-of-truth rule (§1) · exempt-time code list · all corrections immutable in audit · data owner = WFM Analyst.

## 12. Definition of Done
Every agent-day reconciled across 3 sources · all 9 mismatch types auto-flagged · adherence excludes exempt time · corrections audited · 4 reports populate automatically.
