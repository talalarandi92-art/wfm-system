-- 061_audit_tables.sql
-- Governance audit tables (spec §27-30). Seeded with REAL content describing the
-- actual roster suite; code_audit_log is also cross-checked live against
-- schema_migrations by the API. status: Pass | Warning | Fail.

CREATE TABLE IF NOT EXISTS page_module_audit (
  tenant_id UUID NOT NULL, name TEXT NOT NULL, purpose TEXT, status TEXT DEFAULT 'Pass',
  issues TEXT, fix TEXT, priority TEXT DEFAULT 'normal', notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, name)
);
CREATE TABLE IF NOT EXISTS code_audit_log (
  tenant_id UUID NOT NULL, component TEXT NOT NULL, code_type TEXT, status TEXT DEFAULT 'Pass',
  issue TEXT, risk TEXT DEFAULT 'low', fix TEXT, test_result TEXT, notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, component)
);
CREATE TABLE IF NOT EXISTS assistant_workflow_audit (
  tenant_id UUID NOT NULL, step_no INT NOT NULL, assistant TEXT NOT NULL, responsibility TEXT,
  input TEXT, output TEXT, status TEXT DEFAULT 'Pass', issues TEXT, notes TEXT,
  PRIMARY KEY (tenant_id, step_no)
);

INSERT INTO page_module_audit (tenant_id,name,purpose,status,notes) VALUES
 ('a0000000-0000-0000-0000-000000000001','Roster (/roster)','Combined daily roster — punch+Ameyo+Sprinklr vs schedule','Pass','clean identity, active-only default'),
 ('a0000000-0000-0000-0000-000000000001','Executive Overview (/wfm-overview)','Command-center KPIs + data health + tool tiles','Pass','reuses dashboard+integrity'),
 ('a0000000-0000-0000-0000-000000000001','Analytics Dashboard (/roster-dashboard)','KPIs, rankings, distributions, filters','Pass','dedupe by person_no, 8h-role exclusion'),
 ('a0000000-0000-0000-0000-000000000001','Dashboard Builder (/dashboard-builder)','Custom KPI cards/charts/filters/save-view','Pass',NULL),
 ('a0000000-0000-0000-0000-000000000001','Report Builder (/report-builder)','36 fields / 26 KPIs / groups / filters / Excel + 36 presets','Pass',NULL),
 ('a0000000-0000-0000-0000-000000000001','Data Quality (/data-quality)','Identity/duplicate/inactive/orphan audit + TL management + master Excel','Pass',NULL),
 ('a0000000-0000-0000-0000-000000000001','Schedule Change Log (/schedule-change-log)','Edit/swap shift + before/after impact + revert','Pass','migration 059'),
 ('a0000000-0000-0000-0000-000000000001','Interval Headcount (/interval-headcount)','Half-hourly coverage curve + permission/leave impact','Pass','cross-midnight aware'),
 ('a0000000-0000-0000-0000-000000000001','Agent 360 (/agent-360)','Per-agent attendance/tardiness/OT/shift-rate/trend','Pass',NULL)
ON CONFLICT (tenant_id,name) DO NOTHING;

INSERT INTO code_audit_log (tenant_id,component,code_type,status,risk,notes) VALUES
 ('a0000000-0000-0000-0000-000000000001','import-roster-master.js','Node ingest','Pass','low','cross-midnight OT fixed + caps; reads monthly matrix + Timing'),
 ('a0000000-0000-0000-0000-000000000001','backfill-identity.js','Node backfill','Pass','low','canonical identity 163->141; re-scrubs hidden TLs'),
 ('a0000000-0000-0000-0000-000000000001','fix-ot-noise.js','Node corrective','Pass','low','idempotent; OT-before 1.53M->174k min'),
 ('a0000000-0000-0000-0000-000000000001','recon.controller.ts','NestJS API','Pass','low','184 GET endpoints, 0 5xx (smoke)'),
 ('a0000000-0000-0000-0000-000000000001','migrate.js','Node migration runner','Pass','low','records schema_migrations, per-file txn')
ON CONFLICT (tenant_id,component) DO NOTHING;

INSERT INTO assistant_workflow_audit (tenant_id,step_no,assistant,responsibility,input,output,status,notes) VALUES
 ('a0000000-0000-0000-0000-000000000001',1,'Ingest','Parse schedule + punch + Ameyo + Sprinklr + Odoo','source workbooks','roster_days rows','Pass','week-by-week validated'),
 ('a0000000-0000-0000-0000-000000000001',2,'Identity backfill','Collapse old/new IDs, role-hours, active flag','employees+functions+roster_days','employee_identity + stamped roster','Pass','21 humans merged'),
 ('a0000000-0000-0000-0000-000000000001',3,'OT-noise corrective','Fix cross-midnight OT-before + caps','roster_days','corrected ot_before/after/min','Pass','idempotent'),
 ('a0000000-0000-0000-0000-000000000001',4,'TL scrub','Remove hidden team-leader labels','team_leader_status','roster_days team_manager nulled','Pass','Aya removed'),
 ('a0000000-0000-0000-0000-000000000001',5,'API + dashboards','Serve clean KPIs/reports/exports','roster_days + employee_identity','dashboards, report builder, Excel','Pass','dedupe by person_no')
ON CONFLICT (tenant_id,step_no) DO NOTHING;
