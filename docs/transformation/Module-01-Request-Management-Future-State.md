# Module 01 — Request Management (Future-State)
**Boutiqaat Contact Center Transformation** · Owner: Ops & WFM · Status: Design for build

---

## 1. Purpose
One governed channel for **every** agent request — from submission to approval to schedule/attendance update — with full audit, SLA, and headcount-impact control. Replaces WhatsApp groups and manual sheets.

**Outcome:** faster decisions, protected coverage, fair and traceable approvals, clean data for payroll and coaching.

---

## 2. Request types in scope
| Group | Types |
|---|---|
| Intraday | Permission, Late permission, Early out, Break exception, Temp-out / return |
| Leave | Annual, Sick, Emergency, Death, Comp-off, University / Exam |
| Schedule | Shift swap, Off swap, Overtime, WFH, Schedule change, Exception |
| Attendance fix | Manual correction, Missing fingerprint, Missing system login/logout |

> New types to add vs today's platform: **WFH, University/Exam, Emergency, Schedule change, Attendance correction**. Permission, Early-out, Late, Shift/Off swap, Overtime, Sick, Annual already exist.

---

## 3. Data captured per request (single source of truth)
Identity: Request ID · Type · Agent ID/Name · Function/Channel · Team Leader · Shift code/start/end.
Timing: Request date · Submitted time · Requested from/to · Requested duration.
Lifecycle: Status · Pending-with · Approval level · Approved-by · Rejected-by · Decision time · **Response time** · **SLA status** · Reason · Attachment.
Impact: Schedule impact · Attendance impact · **Headcount impact (interval snapshot)** · SLA/queue impact · Payroll impact.
Control: Policy-exception flag · Coaching flag (if repeated) · Full audit trail.

*(This is exactly the `FACT_Request` sheet in the WFM Control Workbook — the report is already designed.)*

---

## 4. Lifecycle & states
```
Draft → Submitted → [Peer review*] → Pending L1 (TL) → Pending L2 / RTA-WFM
   → Approved → Applied to schedule/attendance → Closed
                         ↘ Rejected → Closed (reason recorded)
                         ↘ Cancelled (by agent before decision)
   * Peer review only for Shift/Off swap (colleague must accept first)
```
Every state change writes an **append-only audit row** (actor, time, old→new, reason).

---

## 5. Approval routing & SLA matrix
| Type | Peer | L1 | L2 / Validate | SLA target* | HC gating |
|---|---|---|---|---|---|
| Permission / Late / Early-out | — | TL | RTA coverage check | 30 min | ON |
| Break exception | — | TL | — | 15 min | ON |
| Shift swap / Off swap | ✅ colleague | TL | WFM (rest+gender+skill+coverage) | 4 h / day-before cutoff | ON |
| Overtime | — | TL raise | WFM approve (tied to gap) | 2 h | Gap-driven |
| WFH | — | TL | WFM (eligibility+coverage) | 4 h | ON |
| Annual leave | — | TL | WFM → HR balance | 24–48 h | Balance+blackout |
| Sick leave | — | TL ack | HR (cert if > N days) | retroactive | — |
| Emergency / Death | — | TL fast-track | WFM post-hoc | immediate | — |
| University / Exam | — | TL | WFM (proof + schedule fit) | 24 h | ON |
| Schedule change / Exception | — | — | WFM only | 24 h | ON |
| Attendance correction / Missing punch/login | — | TL raise | WFM verify vs source | 24 h | — |

\* Configurable in `REF_Policy`. **No auto-approval** — every request needs human approval (Ops decision). Leave-type SLA is relaxed; exceeding it is acceptable.

---

## 6. Core workflows (arrow format)

**Permission / Late / Early-out**
```
Agent submits → System captures time + from/to + duration
→ Validates required fields + weekly quota (max 3/week)
→ Detects before-shift vs during-shift
→ Pulls shift, function, Required-HC by interval, Scheduled-HC
→ Calculates interval HC impact (before/after)
→ TL reviews business reason → RTA validates coverage
→ Approve / Reject (critical gap → WARN + WFM override, not auto-reject)
→ Agent notified → Attendance + adherence updated → Dashboards refresh
```

**Shift swap / Off swap (peer first)**
```
Agent A requests swap with Agent B
→ B accepts / rejects (peer step)
→ If accepted: system validates rest ≥ 10h, gender rule, skill match, coverage both days
→ TL reviews → WFM approves
→ Both schedules versioned + shift-rate impact recorded (pre-swap basis kept for fairness)
→ Both agents notified → Audit trail written
```

**Overtime (gap-driven)**
```
Coverage gap detected (or TL raises) → System suggests OT slot + eligible agents
→ TL nominates → WFM approves against the interval gap
→ Schedule + Final-HC updated (OT adds capacity) → Payroll flag set → Audit
```

**Attendance correction / missing fingerprint / missing login**
```
Agent or TL raises correction → System compares schedule vs fingerprint vs system log
→ Flags mismatch type (no login / no punch / late one side / missing logout / cross-midnight)
→ WFM verifies against source evidence → Approve / Reject
→ Attendance record corrected → Old→New stored in audit → Report updated
```

---

## 7. Headcount-impact gating (the control that protects SLA)
```
On submit / before approval:
  Final Available HC (interval) = Scheduled − approved perms/early − sick − absent − no-show − system-down + approved OT + cross-skill cover
  Effective Capacity = Final HC × concurrency (digital = 4 | voice = 1)
  Gap = Effective Capacity − Required HC
  Risk = OK / Watch (−10%) / High (−20%) / Critical (<−20%)
```
- **Watch / High** → approver sees an amber warning, can proceed.
- **Critical** → warning **+ automatic notification to WFM / RTA**; approver still decides (no hard block, no auto-reject).
- Every decision is logged with the HC-impact snapshot.

---

## 8. Automation in this module
- Auto-route to correct approver by type + function + TL.
- Auto-validate mandatory fields + weekly/period quotas + blackout calendar.
- Auto-calculate duration, response time, SLA countdown.
- Auto-run interval HC-impact at submission.
- Auto-escalate when SLA breached (TL → WFM → Ops).
- Auto-notify agent on every state change.
- Auto-apply to schedule/attendance on approval.
- Auto-flag repeated behaviour (≥3 in 30 days) → coaching.
- Auto-write audit on every change/override.

---

## 9. AI in this module (human-in-the-loop)
```
AI reviews request → checks agent history + coverage + affected intervals + SLA risk
→ Recommends Approve / Reject / Escalate (with reason)
→ Human approver decides → System stores AI recommendation AND final decision
```
Also: AI daily WFM summary of pending/at-risk requests · AI plain-language SLA-risk explanation · AI detection of suspicious attendance-correction patterns.

---

## 10. Policy controls (configurable, versioned)
Weekly permission quota (3) · permission min 30 / max 180 min · adherence target 85–90% · SLA targets per type. **No auto-approval.** Leave caps & balance = **deferred (later phase)**.

**Campaign / Blackout Calendar** (Ops-owned, fed progressively by WFM Manager):
```
Add campaign → date range (from → to) + campaign type (e.g. Flash Sale, Eid, Mega Sale)
→ During the window: leave / swap / WFH requests are restricted or flagged for WFM
→ Required-HC is raised for the campaign → coverage protected on peak days
```

---

## 11. Data sources & integration
| Need | Source | Integration |
|---|---|---|
| Schedule, Required-HC | WFM platform | Native |
| Live coverage / state | Sprinklr / Ameyo | Feed (live bridge exists) |
| Fingerprint in/out | Attendance device | Import |
| System login/logout | Sprinklr / Ameyo | Import |
| Leave balance | HR / ERP | **Deferred (later phase)** |
| Payroll OT / deduction | ERP / Payroll | **Deferred (later phase)** |
| Agent master / skills / TL | HR + WFM | Partial |

---

## 12. Reports & dashboards this module feeds
Request Master · Request SLA · Headcount Impact · Interval Impact · TL Control · WFM/RTA Control · Exception & Audit → all already designed in **`Boutiqaat_WFM_Control_Workbook.xlsx`** (`FACT_Request` + `FACT_Interval`). Role dashboards: Exec / WFM / TL / Agent.

---

## 13. Build status (ready vs to-build)
**Already in platform:** multi-level approval, permission interval HC-impact (before/after), shift-swap peer acceptance + rest/gender/skill validation, append-only audit, detailed request/SLA/permission/OT/audit Excel exports, Sprinklr live state, **Campaign / Blackout Calendar (built — `/campaigns`: add by date range + type, restricts request types, HC uplift; blackout-check wired into leave + shift/off-swap submission → flags request + notifies WFM/RTA, warn-only; **permissions during any active campaign auto-flagged as EXCEPTIONAL (urgent + notify), per Ops rule**)**.
**Built (Phase 1 — ALL new request types done):** **Emergency leave** · **University/Exam** (leave-flow types, campaign-aware) · **WFH** (leave option) · **Attendance correction** (`/attendance-corrections` — approval applies fix to `attendance_records`, clears missing flags, audited) · **Schedule change** (`/schedule-changes` — approval applies the new shift's times to `attendance_records`, audited).
**Built:** **SLA auto-escalation** (`/sla/escalate-overdue` + background loop every 3 min — escalates pending requests past `sla_due_at`, notifies WFM/RTA/Ops, idempotent via `requests.escalated_at`, audited).
**To build / connect:** leave-balance + payroll integration, AI recommendation, role dashboards.

---

## 14. Governance & audit
- Single glossary signed by Ops + HR + WFM (late / present / productive / exempt).
- Approval authority matrix locked (Section 5).
- Every manual override = reason + audit row (immutable).
- Role-based access (Agent / TL / RTA / WFM / Ops / HR).
- Data owner: WFM Analyst (request data) · HR (leave/payroll) · Governance (audit).

---

## 15. Decisions (confirmed by Ops)
1. **SLA:** intraday (permission / late / early-out) = **30 min**; leave-type SLA relaxed — exceeding it is acceptable. ✔
2. **Auto-approve:** **No** — every request needs human approval. ✔
3. **Critical HC gap:** **Warning + notification to WFM/RTA**; approver still decides (no hard block). ✔
4. **Leave balance + payroll integration:** **Deferred to a later phase.** ✔
5. **New types in Phase 1 scope:** **Attendance correction + Emergency leave** (confirmed). WFH · University/Exam · Schedule change → Phase 2. ✔
6. **Campaign calendar:** Ops feeds dates progressively. Feature confirmed — add a campaign by **date range (from → to) + campaign type**; requests in the window are restricted/flagged. ✔

### Phase 1 type scope (locked)
- **Phase 1 builds:** existing types + **Attendance correction** + **Emergency leave**.
- **Phase 2 adds:** **WFH · University/Exam · Schedule change**.

---

## 16. Definition of Done
- Every request has: full field set, SLA timestamps, HC-impact snapshot, complete audit.
- Routing, notifications, escalation fully automatic.
- Approval updates schedule + attendance + dashboards with no manual step.
- All 6 open decisions answered and configured in `REF_Policy`.
