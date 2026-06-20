-- 038_leave_balances.sql
-- Leave entitlement ledger. Only the ENTITLEMENT is stored here; "taken" and
-- "pending" are always computed live from approved/pending leave requests
-- (request_leaves.duration_days) so the balance can never drift out of sync.

CREATE TABLE IF NOT EXISTS leave_balances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type       varchar(40) NOT NULL,          -- annual_leave, sick_leave, comp_off …
  calendar_year    integer NOT NULL,
  entitlement_days numeric(5,1) NOT NULL DEFAULT 0,
  notes            text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, leave_type, calendar_year)
);
CREATE INDEX IF NOT EXISTS idx_leave_balances_emp
  ON leave_balances(tenant_id, employee_id, calendar_year);
