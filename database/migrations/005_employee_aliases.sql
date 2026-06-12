-- ============================================================================
-- 005 — Employee aliases (duplicate-employee merge support)
--
-- Employee numbers sometimes change between monthly workbook imports, which
-- creates duplicate employee records (same person, different employee_no).
-- When WFM confirms a merge, the losing record's employee_no is preserved
-- here as an alias of the surviving employee so future imports using the
-- old number can still resolve to the right person.
-- ============================================================================

CREATE TABLE employee_aliases (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID         NOT NULL REFERENCES tenants(id)   ON DELETE RESTRICT,
    employee_id      UUID         NOT NULL REFERENCES employees(id) ON DELETE CASCADE,  -- surviving employee
    old_employee_no  VARCHAR(50)  NOT NULL,                                             -- the retired number
    old_employee_id  UUID         REFERENCES employees(id) ON DELETE SET NULL,          -- the deactivated duplicate record
    merged_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
    merged_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    notes            TEXT,
    UNIQUE (tenant_id, old_employee_no)
);

CREATE INDEX idx_emp_aliases_tenant   ON employee_aliases(tenant_id);
CREATE INDEX idx_emp_aliases_employee ON employee_aliases(employee_id);
CREATE INDEX idx_emp_aliases_old_no   ON employee_aliases(tenant_id, old_employee_no);
