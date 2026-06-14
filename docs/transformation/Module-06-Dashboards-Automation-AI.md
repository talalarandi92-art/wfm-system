# Module 06 — Dashboards, Automation & AI Layer
**Boutiqaat Contact Center Transformation** · Owner: WFM / BI · Status: Design for build · **Phase 1 (dashboards + automation) → Phase 3 (AI)**

Cross-cutting layer: presents every module's data by role, runs the automation rules engine, and hosts the AI services.

---

## 1. Role dashboards (same facts, filtered by role)

**Executive** — total requests (appr/rej/pend) · avg approval time · HC loss · OT added · net staffing impact · top impacted functions/shifts/intervals · SLA-risk intervals · attendance risk · coaching required.

**WFM / RTA** — Required vs Scheduled vs Actual HC · interval gap heatmap · pending requests by urgency · requests hitting current shift · late/early/sick impact · OT coverage · real-time risk · action required.

**Team Leader** — team attendance today · pending requests · late/early agents · team adherence % · coaching flags · agents to follow up.

**Agent** — my schedule · my requests + status · approved permissions · leave balance (later) · attendance + late/early history · coaching reminders · notifications.

All read the shared facts (`FACT_Attendance` / `FACT_Interval` / `FACT_Request`).

---

## 2. Automation rules engine (centralised)
```
Submit → validate fields + quota + blackout calendar
→ auto-calc duration + response time + SLA countdown
→ auto-route to approver (type + function + TL)
→ auto-run interval HC-impact
→ Critical gap → warn + notify WFM/RTA (no block — Ops decision)
→ decision → auto-apply to schedule/attendance → auto-notify agent
→ SLA breach → auto-escalate (TL → WFM → Ops)
→ repeated behaviour → auto-flag coaching → auto-write audit
```

## 3. AI services (human-in-the-loop — always)
```
AI produces recommendation → human decides → store BOTH (rec + decision)
```
- Request recommendation (approve / reject / escalate + reason)
- HC risk summary + suggested action plan
- Attendance anomaly / fraud detection
- Coaching recommendation · TL performance insight
- WFM daily NL summary · SLA-risk explanation
- Intraday re-forecast / schedule-adjustment suggestion

---

## 4. Build status
**Built:** **Role dashboards** — `/control-dashboard` KPI bundle (requests + attendance + coaching + campaigns + OT from the real facts) rendered by `/control-dashboards` page with **Exec / WFM / TL / Agent** tabs (role-relevant KPI slices + by-type and by-function breakdowns). **SLA auto-escalation** (Module 01) and **coaching engine** (Module 05) automations live.
**Ready:** notifications, audit, Sprinklr live tiles.
**To build:** full rules-engine consolidation, all AI services.

## 5. Governance
Role-based access enforced per dashboard · AI recommendations never auto-act · every automated action writes audit.

## 6. Definition of Done
4 role dashboards live on shared facts · rules engine runs the full §2 flow · AI services advise with stored rec+decision · no automated hard-rejections.
