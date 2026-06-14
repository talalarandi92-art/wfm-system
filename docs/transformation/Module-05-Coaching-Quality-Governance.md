# Module 05 — Coaching, Quality & Attendance Governance
**Boutiqaat Contact Center Transformation** · Owner: Ops / TL / WFM · Status: Design for build · **Phase 2**

---

## 1. Purpose
Turn data into people-action: trigger coaching from attendance, adherence, and quality signals; give TLs a control view; and keep a full exception & audit trail.

---

## 2. Coaching triggers (auto)
- Repeated late ≥ 3 / 30 days
- Repeated early-out ≥ 3 / 30 days
- Adherence < 85% (rolling)
- Break overuse
- Quality / quiz / CSAT below target (from scorecard)
- Repeated unapproved requests

→ Trigger creates a **coaching case** with the evidence attached.

## 3. Coaching workflow
```
Trigger detected → coaching case created (auto, with evidence)
→ TL conducts 1:1 → records feedback + action plan + follow-up date
→ Agent acknowledges → outcome tracked
→ Re-check after the period → close or escalate
```

---

## 4. Team Leader Control report (report 10)
Per TL: team requests · approved / rejected / pending · avg approval time · SLA-breached approvals · team lateness / early-out / absence · team adherence % · team HC impact · coaching actions · repeated agent issues · **operational risk score**.

## 5. Exception & Audit (report 12) — governance
Every manual override / correction / exception:
`case-id · action · old value · new value · updated by · date-time · reason · manual-override flag · policy-exception flag · evidence · comments` — **append-only, immutable**.

---

## 6. Governance framework (program-wide)
- One signed glossary (late / present / productive / adherent / exempt).
- Approval authority matrix (Module 01 §5).
- Exempt-time code list.
- Role-based access: Agent / TL / RTA / WFM / Ops / HR.
- Data owners: WFM (attendance, requests) · HR (leave, payroll — later) · Governance (audit).

## 7. Automation
Auto-flag triggers · auto-create coaching case · auto-attach evidence · auto-link to scorecard · auto-write audit on every change.

## 8. AI
Coaching **recommendation** (what to coach, based on pattern) · **TL performance insight** · repeated-issue detection across the team.

## 9. Build status
**Built (full coaching loop):** **trigger engine** — `coaching_flags` (migration 028) + background scan (every 6h) flagging repeated late / early-out / missing-punch over 30 days, severity low/med/high, idempotent, notifies TL/WFM/Ops. **Flag → 1:1 session** — `POST /coaching/flags/:id/schedule-session` creates a `coaching_sessions` row (focus = trigger), links + closes the flag, notifies the employee, audited. `/coaching` API (flags/scan/address/dismiss/schedule-session/sessions) + Coaching page with Flags & Sessions views.
**Ready:** scorecard module (partial), append-only audit log, attendance signals.
**To build:** TL Control report, low-adherence + quality triggers (need Module 02/scorecard data), risk score.

## 10. Definition of Done
Triggers auto-create coaching cases with evidence · 1:1 + action plan + follow-up tracked · TL Control + Exception/Audit reports live · all overrides immutable.
