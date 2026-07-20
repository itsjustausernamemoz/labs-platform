-- Multi-tenant RLS: helper functions, policies for the new tables, and a
-- targeted tightening of legacy blanket-permissive policies on
-- submissions/violations/exams that predate any tenant model.

-- ============================================================================
-- 1. Helper functions (SECURITY DEFINER so they can be used inside RLS
--    USING clauses without recursive-RLS deadlocks on their own tables)
-- ============================================================================
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_admins WHERE id = auth.uid() AND active = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION is_institution_admin(inst_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM institution_admins
    WHERE id = auth.uid() AND institution_id = inst_id AND active = TRUE
  );
$$;

-- ============================================================================
-- 2. RLS on every new table
-- ============================================================================
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- platform_admins: self-select (no recursion) + platform admins manage all
DROP POLICY IF EXISTS "Admins can view own row" ON platform_admins;
CREATE POLICY "Admins can view own row" ON platform_admins
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "Platform admins manage platform_admins" ON platform_admins;
CREATE POLICY "Platform admins manage platform_admins" ON platform_admins
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- institution_admins: self-select + institution-scoped + platform admin full
DROP POLICY IF EXISTS "Institution admins can view own row" ON institution_admins;
CREATE POLICY "Institution admins can view own row" ON institution_admins
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "Institution admins manage own institution admins" ON institution_admins;
CREATE POLICY "Institution admins manage own institution admins" ON institution_admins
  FOR ALL TO authenticated
  USING (is_institution_admin(institution_id) OR is_platform_admin())
  WITH CHECK (is_institution_admin(institution_id) OR is_platform_admin());

-- institutions: platform admins manage everything; institution admins can
-- view/update their own; institution name/plan/seat-limits carry no PII so
-- anon (students/lecturers, who have no JWT) may read by id, matching the
-- existing pragmatic posture already used for lecturer_profiles.
DROP POLICY IF EXISTS "Platform admins manage institutions" ON institutions;
CREATE POLICY "Platform admins manage institutions" ON institutions
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "Institution admins update own institution" ON institutions;
CREATE POLICY "Institution admins update own institution" ON institutions
  FOR UPDATE TO authenticated USING (is_institution_admin(id)) WITH CHECK (is_institution_admin(id));

DROP POLICY IF EXISTS "Anyone can view institutions" ON institutions;
CREATE POLICY "Anyone can view institutions" ON institutions
  FOR SELECT TO anon, authenticated USING (true);

-- cohorts
DROP POLICY IF EXISTS "Institution admins manage own cohorts" ON cohorts;
CREATE POLICY "Institution admins manage own cohorts" ON cohorts
  FOR ALL TO authenticated
  USING (is_institution_admin(institution_id) OR is_platform_admin())
  WITH CHECK (is_institution_admin(institution_id) OR is_platform_admin());

DROP POLICY IF EXISTS "Anon can view cohorts" ON cohorts;
CREATE POLICY "Anon can view cohorts" ON cohorts FOR SELECT TO anon USING (true);

-- issues: institution admins manage their own; anyone (lecturer/student/anon)
-- can file one — institution_id is supplied app-side from the reporter's own
-- resolved institution, same UUID-possession trust model as submissions below
DROP POLICY IF EXISTS "Institution admins manage own issues" ON issues;
CREATE POLICY "Institution admins manage own issues" ON issues
  FOR ALL TO authenticated
  USING (is_institution_admin(institution_id) OR is_platform_admin())
  WITH CHECK (is_institution_admin(institution_id) OR is_platform_admin());

DROP POLICY IF EXISTS "Anon can create issues" ON issues;
CREATE POLICY "Anon can create issues" ON issues FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can create issues" ON issues;
CREATE POLICY "Authenticated can create issues" ON issues FOR INSERT TO authenticated WITH CHECK (true);

-- subscriptions / invoices: platform admins manage; institution admins read-only
DROP POLICY IF EXISTS "Platform admins manage subscriptions" ON subscriptions;
CREATE POLICY "Platform admins manage subscriptions" ON subscriptions
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "Institution admins view own subscription" ON subscriptions;
CREATE POLICY "Institution admins view own subscription" ON subscriptions
  FOR SELECT TO authenticated USING (is_institution_admin(institution_id));

DROP POLICY IF EXISTS "Platform admins manage invoices" ON invoices;
CREATE POLICY "Platform admins manage invoices" ON invoices
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "Institution admins view own invoices" ON invoices;
CREATE POLICY "Institution admins view own invoices" ON invoices
  FOR SELECT TO authenticated USING (is_institution_admin(institution_id));

-- platform_settings / feature_flags: platform admin write, everyone read
-- (announcement banner + feature-flag gating needed by student/lecturer apps)
DROP POLICY IF EXISTS "Platform admins manage settings" ON platform_settings;
CREATE POLICY "Platform admins manage settings" ON platform_settings
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "Everyone can read settings" ON platform_settings;
CREATE POLICY "Everyone can read settings" ON platform_settings FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Platform admins manage feature flags" ON feature_flags;
CREATE POLICY "Platform admins manage feature flags" ON feature_flags
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "Everyone can read feature flags" ON feature_flags;
CREATE POLICY "Everyone can read feature flags" ON feature_flags FOR SELECT TO anon, authenticated USING (true);

-- audit_log: no direct INSERT policy — all writes go through log_audit_event()
-- below so actor_name/actor_role can't be spoofed by a crafted client insert.
DROP POLICY IF EXISTS "Platform admins view audit log" ON audit_log;
CREATE POLICY "Platform admins view audit log" ON audit_log
  FOR SELECT TO authenticated USING (is_platform_admin());

DROP POLICY IF EXISTS "Institution admins view own audit log" ON audit_log;
CREATE POLICY "Institution admins view own audit log" ON audit_log
  FOR SELECT TO authenticated USING (institution_id IS NOT NULL AND is_institution_admin(institution_id));

CREATE OR REPLACE FUNCTION log_audit_event(p_action TEXT, p_target TEXT, p_institution_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_role TEXT;
BEGIN
  IF is_platform_admin() THEN
    SELECT full_name INTO v_name FROM platform_admins WHERE id = auth.uid();
    v_role := 'platform_admin';
  ELSIF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_name FROM institution_admins WHERE id = auth.uid();
    v_role := 'institution_admin';
  ELSE
    v_name := 'System';
    v_role := 'System';
  END IF;

  INSERT INTO audit_log (actor_id, actor_name, actor_role, institution_id, action, target)
  VALUES (auth.uid(), COALESCE(v_name, 'Unknown'), v_role, p_institution_id, p_action, p_target);
END;
$$;
GRANT EXECUTE ON FUNCTION log_audit_event(TEXT, TEXT, UUID) TO authenticated;

-- ============================================================================
-- 3. Legacy tightening: exams / submissions / violations
--
-- Students authenticate with no Supabase JWT at all (student_number lookup +
-- localStorage pseudo-session — see student/src/pages/StudentLogin.tsx), so
-- there is no session token to scope anon policies by. The only honest fix
-- available without introducing a new auth model is to stop the blanket
-- USING(true) policies from letting anon TAMPER with grading data or
-- ENUMERATE exams, while consciously leaving blind SELECT-by-UUID as documented,
-- accepted status quo (identical to the existing lecturer_profiles posture).
-- ============================================================================

-- exams: drop the always-true "enrollment_code IS NOT NULL" escape hatch —
-- every exam row has a non-null enrollment_code, so this let anon enumerate
-- every exam regardless of whether they actually know its code.
DROP POLICY IF EXISTS "Students see active exams" ON exams;
CREATE POLICY "Students see active exams" ON exams
  FOR SELECT TO anon
  USING (is_active = true);

-- submissions: revoke the blanket public policies from 20240317000020, which
-- currently let ANY caller (anon or authenticated, on any exam) overwrite any
-- submission's score/graded/marking_details. Replace with role-scoped
-- equivalents; the already-scoped "Lecturers manage submissions" and
-- "Students can create submissions" policies from 20260413000000 are untouched.
DROP POLICY IF EXISTS "Permissive select for submissions" ON submissions;
DROP POLICY IF EXISTS "Permissive insert for submissions" ON submissions;
DROP POLICY IF EXISTS "Permissive update for submissions" ON submissions;

CREATE POLICY "Anon can select submissions" ON submissions
  FOR SELECT TO anon USING (true);
  -- Kept permissive on SELECT: tightening this requires a real student
  -- session token this app doesn't have. UUID-possession is the de-facto
  -- access control here, same as lecturer_profiles' own SELECT USING(true).
  -- Documented, accepted risk — not a regression from status quo.

CREATE POLICY "Anon can autosave draft answers" ON submissions
  FOR UPDATE TO anon
  USING (status = 'draft')
  WITH CHECK (status = 'draft');
  -- Combined with the trigger below, this still cannot alter grading columns
  -- even while status = 'draft'; once status flips to 'submitted', anon loses
  -- UPDATE access entirely.

CREATE OR REPLACE FUNCTION guard_submission_grading_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- 'service_role' is the grade-submission edge function's own AI-grading
  -- writes; 'authenticated' is a lecturer/co-marker session. Anything else
  -- (anon) may not touch grading fields, even during its own draft-update.
  IF auth.role() NOT IN ('authenticated', 'service_role') THEN
    IF NEW.score IS DISTINCT FROM OLD.score
       OR NEW.graded IS DISTINCT FROM OLD.graded
       OR NEW.marking_details IS DISTINCT FROM OLD.marking_details
       OR NEW.is_manual IS DISTINCT FROM OLD.is_manual
       OR NEW.marked_by_email IS DISTINCT FROM OLD.marked_by_email
       OR NEW.marked_by_name IS DISTINCT FROM OLD.marked_by_name THEN
      RAISE EXCEPTION 'Grading fields can only be modified by an authenticated lecturer session';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_submission_grading ON submissions;
CREATE TRIGGER trg_guard_submission_grading BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION guard_submission_grading_columns();

-- violations: the SELECT side has been wide open to anyone since the
-- 20240317000020 reset (the lecturer-scoped SELECT that migration removed
-- was never restored — only DELETE was, in 20240317000021). Restore a real
-- scoped SELECT policy; leave anon INSERT permissive (telemetry writes with
-- no sensitive read-back, and TabGuard needs to post violations with no
-- session at all).
DROP POLICY IF EXISTS "Permissive select for violations" ON violations;
DROP POLICY IF EXISTS "Lecturers can view violations for their exams" ON violations;
CREATE POLICY "Lecturers can view violations for their exams" ON violations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM exams
      WHERE exams.id = violations.exam_id
      AND (
        exams.lecturer_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM exam_lecturers
          WHERE exam_lecturers.exam_id = exams.id
          AND exam_lecturers.lecturer_email = (auth.jwt() ->> 'email')
        )
      )
    )
  );
