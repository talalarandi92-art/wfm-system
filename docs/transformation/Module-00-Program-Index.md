# Boutiqaat Contact Center Transformation — Program Index
Owner: Operations & WFM Manager · Companion to `Boutiqaat_WFM_Control_Workbook.xlsx`

This is the cover/index for the transformation module set. Each module is a concise, build-ready design doc.

---

## Module set
| # | Module | Phase | Owner |
|---|---|---|---|
| 01 | [Request Management](Module-01-Request-Management-Future-State.md) | 1 | Ops / WFM |
| 02 | [Attendance & Adherence (Fingerprint vs System)](Module-02-Attendance-Adherence.md) | 1 (critical path) | WFM |
| 03 | [Headcount, Interval & Forecast + Shrinkage](Module-03-Headcount-Interval-Forecast.md) | 1 → 2 | WFM |
| 04 | [RTA & Intraday Control](Module-04-RTA-Intraday-Control.md) | 2 | RTA / WFM |
| 05 | [Coaching, Quality & Governance](Module-05-Coaching-Quality-Governance.md) | 2 | Ops / TL / WFM |
| 06 | [Dashboards, Automation & AI](Module-06-Dashboards-Automation-AI.md) | 1 → 3 | WFM / BI |

---

## Locked decisions (apply to all modules)
1. **SLA:** intraday requests = 30 min; leave-type SLA relaxed.
2. **No auto-approval** — every request needs human approval.
3. **Critical HC gap → warning + notification** to WFM/RTA; approver still decides (no hard block).
4. **Leave balance + payroll integration → deferred** to a later phase.
5. **Phase 1 new request types:** Attendance correction + Emergency leave. Phase 2: WFH, University/Exam, Schedule change.
6. **Campaign calendar:** Ops-fed; add by date range (from → to) + campaign type; restricts requests in-window.

### Standing principles
- **Two facts + one reference:** Attendance/Interval fact + Request fact + Required-HC reference. Every report is a pivot on these.
- **Source of truth:** System/state = coverage & adherence; Fingerprint = payroll & presence.
- **Exempt time** (training/meeting/coaching/system-down) excluded from non-adherence — fairness.
- **Concurrency:** digital (chat/WhatsApp) = 4; voice = 1.
- **Week:** Saturday → Friday; **weekend = Thu/Fri/Sat**.

---

## Phase roadmap
- **Phase 1 (0–8 wks) — Foundation & quick wins:** Request mgmt, Attendance reconciliation, Interval HC-impact, core Excel workbook, core automation, role dashboards (v1).
- **Phase 2 (2–4 mo) — Control layer:** Forecast + shrinkage, real-time adherence (exempt-aware), coaching triggers, RTA control, blackout calendar.
- **Phase 3 (4–8 mo) — Intelligence:** AI recommendations, anomaly detection, intraday re-forecast, NL summaries, CRM/ERP + payroll/leave integration.

---

## Reporting
All 12 reports + 4 role dashboards are designed in `Boutiqaat_WFM_Control_Workbook.xlsx` (FACT_Attendance / FACT_Interval / FACT_Request + DASH_* sheets). The platform's `/reports` export engine mirrors these.

## Status
~40% already live in the WFM platform (requests, permission HC-impact, attendance data, breaks, OT, audit, Sprinklr live state, Excel exports). Remaining work is connect + define + build per the phase plan.
