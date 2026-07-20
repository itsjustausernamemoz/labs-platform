-- Multi-tenant schema: institutions, platform admins, institution admins, cohorts,
-- support issues, billing records, platform settings/feature flags, audit log.

-- ============================================================================
-- 1. Enums
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_tier') THEN
    CREATE TYPE plan_tier AS ENUM ('trial', 'standard', 'enterprise');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'institution_status') THEN
    CREATE TYPE institution_status AS ENUM ('active', 'suspended');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_cycle') THEN
    CREATE TYPE billing_cycle AS ENUM ('monthly', 'annual', 'trial');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE invoice_status AS ENUM ('paid', 'past_due', 'trialing');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'issue_category') THEN
    CREATE TYPE issue_category AS ENUM ('technical', 'grading', 'billing', 'account');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'issue_status') THEN
    CREATE TYPE issue_status AS ENUM ('open', 'in_progress', 'escalated', 'resolved');
  END IF;
END $$;

-- ============================================================================
-- 2. institutions — tenant root
-- ============================================================================
CREATE TABLE IF NOT EXISTS institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  plan plan_tier NOT NULL DEFAULT 'trial',
  lecturer_seat_limit INT NOT NULL DEFAULT 5,
  student_seat_limit INT NOT NULL DEFAULT 200,
  status institution_status NOT NULL DEFAULT 'active',
  self_serve_signup BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_institutions_updated_at ON institutions;
CREATE TRIGGER set_institutions_updated_at BEFORE UPDATE ON institutions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 3. platform_admins — Mashoke Tech staff, auth.users-keyed
-- ============================================================================
CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. institution_admins — auth.users-keyed, scoped to exactly one institution
-- ============================================================================
CREATE TABLE IF NOT EXISTS institution_admins (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_institution_admins_institution ON institution_admins(institution_id);

-- ============================================================================
-- 5. cohorts — student groupings within an institution
-- ============================================================================
CREATE TABLE IF NOT EXISTS cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cohorts_institution ON cohorts(institution_id);

-- ============================================================================
-- 6. issues — support tickets, institution-scoped, can escalate to the
--    platform-wide queue
-- ============================================================================
CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category issue_category NOT NULL,
  status issue_status NOT NULL DEFAULT 'open',
  reporter_name TEXT NOT NULL,
  reporter_role TEXT NOT NULL, -- 'lecturer' | 'student' | 'institution_admin'
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_issues_institution ON issues(institution_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);

-- ============================================================================
-- 7. subscriptions — one row per institution, internal record-keeping only
--    (no payment gateway integration)
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL UNIQUE REFERENCES institutions(id) ON DELETE CASCADE,
  plan plan_tier NOT NULL DEFAULT 'trial',
  price_per_month NUMERIC(10,2) NOT NULL DEFAULT 0,
  cycle billing_cycle NOT NULL DEFAULT 'trial',
  next_invoice_date DATE,
  status invoice_status NOT NULL DEFAULT 'trialing',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER set_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 8. invoices — manually-entered per-institution billing history
-- ============================================================================
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(10,2) NOT NULL,
  status invoice_status NOT NULL DEFAULT 'paid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_institution ON invoices(institution_id, invoice_date DESC);

-- ============================================================================
-- 9. platform_settings — singleton
-- ============================================================================
CREATE TABLE IF NOT EXISTS platform_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  standard_price NUMERIC(10,2) NOT NULL DEFAULT 49,
  enterprise_price NUMERIC(10,2) NOT NULL DEFAULT 199,
  announcement TEXT NOT NULL DEFAULT '',
  announcement_published BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS set_platform_settings_updated_at ON platform_settings;
CREATE TRIGGER set_platform_settings_updated_at BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 10. feature_flags
-- ============================================================================
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_feature_flags_updated_at ON feature_flags;
CREATE TRIGGER set_feature_flags_updated_at BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO feature_flags (key, label, detail, enabled) VALUES
  ('ai_assisted_grading', 'AI-assisted grading', 'Gemini/OpenAI auto-marking in the grading workflow', TRUE),
  ('open_book_exam_mode', 'Open-book exam mode', 'Allows exams to be configured as open-book', TRUE),
  ('coding_sandbox', 'In-browser coding sandbox', 'Kotlin Playground coding questions', TRUE),
  ('institution_self_serve_signup', 'Institution self-serve signup', 'Allow institutions to sign up without a platform admin invite', FALSE)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 11. audit_log — append-only, written only via log_audit_event() RPC
--     (see 20260420000001_multi_tenant_rls.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID,            -- auth.users.id when known, NULL for 'System'
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL, -- 'platform_admin' | 'institution_admin' | 'System'
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_institution ON audit_log(institution_id);

-- ============================================================================
-- 12. Multi-tenant scoping columns on existing tables (nullable — see plan
--     notes: the target DB is empty, no backfill problem, and forcing NOT
--     NULL would require a meaningless synthetic "Default Institution")
--     Must precede the institution_stats view below, which reads these columns.
-- ============================================================================
ALTER TABLE exams ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_exams_institution ON exams(institution_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exams_exam_mode_check') THEN
    ALTER TABLE exams ADD CONSTRAINT exams_exam_mode_check CHECK (exam_mode IN ('closed_book', 'open_book'));
  END IF;
END $$;

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_subjects_institution ON subjects(institution_id);

ALTER TABLE lecturer_profiles ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;
ALTER TABLE lecturer_profiles ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_lecturer_profiles_institution ON lecturer_profiles(institution_id);

ALTER TABLE students ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS cohort_id UUID REFERENCES cohorts(id) ON DELETE SET NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_students_institution ON students(institution_id);
CREATE INDEX IF NOT EXISTS idx_students_cohort ON students(cohort_id);

-- Fix a pre-existing bug: the frontend (shared/hooks/useTabGuard.ts) reports a
-- 'cursor_exit' violation type that the original CHECK constraint never allowed.
ALTER TABLE violations DROP CONSTRAINT IF EXISTS violations_violation_type_check;
ALTER TABLE violations ADD CONSTRAINT violations_violation_type_check
  CHECK (violation_type IN ('tab_switch', 'fullscreen_exit', 'blur', 'cursor_exit'));

-- ============================================================================
-- 13. institution_stats — derived seat-usage counts (avoids drifting counters)
-- ============================================================================
CREATE OR REPLACE VIEW institution_stats WITH (security_invoker = true) AS
SELECT
  i.id AS institution_id,
  COUNT(DISTINCT lp.id) AS lecturer_count,
  COUNT(DISTINCT s.id)  AS student_count
FROM institutions i
LEFT JOIN lecturer_profiles lp ON lp.institution_id = i.id
LEFT JOIN students s ON s.institution_id = i.id
GROUP BY i.id;
