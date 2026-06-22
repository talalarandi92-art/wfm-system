-- 059_schedule_change_log.sql
-- Schedule_Change_Log: every manual shift change / swap on the roster, with the
-- before/after values, who/why, approval state, and the computed impact (coverage
-- window + shift-rate distribution) so changes are auditable and reversible.

CREATE TABLE IF NOT EXISTS schedule_change_log (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  change_type   TEXT NOT NULL DEFAULT 'edit',     -- edit | swap
  work_date     DATE NOT NULL,
  person_no     TEXT NOT NULL,                     -- agent A (canonical)
  person_name   TEXT,
  person_b_no   TEXT,                              -- agent B (swap counterpart)
  person_b_name TEXT,
  old_shift     TEXT,
  new_shift     TEXT,
  old_shift_b   TEXT,                              -- swap: B's old shift
  new_shift_b   TEXT,
  reason        TEXT,
  changed_by    TEXT,                              -- actor (user id / name)
  approval_status TEXT NOT NULL DEFAULT 'applied', -- pending | approved | applied | reverted
  impact        JSONB,                             -- {coverage:{...}, shiftRate:{before,after}}
  reverted      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_change_tenant_date ON schedule_change_log(tenant_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_sched_change_person ON schedule_change_log(tenant_id, person_no);
