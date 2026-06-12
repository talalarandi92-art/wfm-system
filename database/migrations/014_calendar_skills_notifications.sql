-- ============================================================================
-- 014 — Calendar Events, Coaching Sessions, Skills Seed, Notifications
-- ============================================================================

-- ── Calendar Events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  event_type    VARCHAR(50)  NOT NULL DEFAULT 'general',
  -- Types: general | coaching | meeting | shift_change | training | cross_skill | off | leave
  start_at      TIMESTAMPTZ  NOT NULL,
  end_at        TIMESTAMPTZ  NOT NULL,
  all_day       BOOLEAN      NOT NULL DEFAULT FALSE,
  location      VARCHAR(255),
  description   TEXT,
  color         VARCHAR(20),
  status        VARCHAR(20)  NOT NULL DEFAULT 'scheduled',
  -- scheduled | completed | cancelled
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cal_events_tenant     ON calendar_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cal_events_start      ON calendar_events(tenant_id, start_at);
CREATE INDEX IF NOT EXISTS idx_cal_events_type       ON calendar_events(tenant_id, event_type);

-- ── Calendar Event Attendees ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_event_attendees (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id    UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  role        VARCHAR(20) NOT NULL DEFAULT 'attendee', -- organizer | attendee
  status      VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | accepted | declined
  notified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cal_attendees_event    ON calendar_event_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_cal_attendees_employee ON calendar_event_attendees(employee_id);
CREATE INDEX IF NOT EXISTS idx_cal_attendees_user     ON calendar_event_attendees(user_id);

-- ── Coaching Sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_sessions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  coach_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  calendar_event_id    UUID REFERENCES calendar_events(id) ON DELETE SET NULL,
  scorecard_batch_id   UUID REFERENCES scorecard_batches(id) ON DELETE SET NULL,
  scheduled_at         TIMESTAMPTZ NOT NULL,
  duration_minutes     INT         NOT NULL DEFAULT 30,
  status               VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  -- scheduled | completed | cancelled | no_show
  focus_areas          TEXT[],            -- e.g. ['quality', 'aht', 'fcr']
  notes                TEXT,
  action_plan          TEXT,
  follow_up_date       DATE,
  employee_acknowledged BOOLEAN   NOT NULL DEFAULT FALSE,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coaching_tenant     ON coaching_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_coaching_employee   ON coaching_sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_coaching_coach      ON coaching_sessions(coach_id);
CREATE INDEX IF NOT EXISTS idx_coaching_date       ON coaching_sessions(tenant_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_coaching_scorecard  ON coaching_sessions(scorecard_batch_id);

-- ── Cross-Skill Move Requests ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cross_skill_moves (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_function   VARCHAR(100),
  to_function     VARCHAR(100),
  start_at        TIMESTAMPTZ NOT NULL,
  end_at          TIMESTAMPTZ NOT NULL,
  reason          TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- pending | approved | rejected | completed
  requested_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  calendar_event_id UUID REFERENCES calendar_events(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xskill_tenant   ON cross_skill_moves(tenant_id);
CREATE INDEX IF NOT EXISTS idx_xskill_employee ON cross_skill_moves(employee_id);
CREATE INDEX IF NOT EXISTS idx_xskill_date     ON cross_skill_moves(tenant_id, start_at);

-- ── Skills Seed for Boutiqaat ────────────────────────────────────────────────
DO $$
DECLARE
  v_tenant UUID;
BEGIN
  SELECT id INTO v_tenant FROM tenants LIMIT 1;
  IF v_tenant IS NULL THEN RETURN; END IF;

  INSERT INTO skills (tenant_id, name, name_ar, code, channel_type, is_active)
  VALUES
    (v_tenant, 'Voice / Inbound',    'مكالمات واردة',       'VOICE',     'voice',   TRUE),
    (v_tenant, 'Chat',               'دردشة مباشرة',        'CHAT',      'chat',    TRUE),
    (v_tenant, 'WhatsApp',           'واتساب',              'WHATSAPP',  'chat',    TRUE),
    (v_tenant, 'Email',              'البريد الإلكتروني',   'EMAIL',     'email',   TRUE),
    (v_tenant, 'Social Media',       'وسائل التواصل',       'SOCIAL',    'social',  TRUE),
    (v_tenant, 'Customer Care',      'خدمة العملاء',        'CC',        NULL,      TRUE),
    (v_tenant, 'Refund Processing',  'معالجة الاسترجاع',    'REFUND',    NULL,      TRUE),
    (v_tenant, 'NPS / Feedback',     'تقييم رضا العملاء',   'NPS',       NULL,      TRUE),
    (v_tenant, 'OMT',                'إدارة الطلبات',       'OMT',       NULL,      TRUE),
    (v_tenant, 'Escalation',         'تصعيد الشكاوى',       'ESC',       NULL,      TRUE),
    (v_tenant, 'Arabic',             'اللغة العربية',       'LANG_AR',   NULL,      TRUE),
    (v_tenant, 'English',            'اللغة الإنجليزية',   'LANG_EN',   NULL,      TRUE),
    (v_tenant, 'Persian / Farsi',    'اللغة الفارسية',      'LANG_FA',   NULL,      TRUE)
  ON CONFLICT DO NOTHING;
END $$;
