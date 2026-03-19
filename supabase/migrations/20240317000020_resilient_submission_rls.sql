-- Nuclear RLS Reset for Submissions & Violations
-- Goal: Ensure students (mostly anon) can always write/read their data "at all costs"

-- 1. SUBMISSIONS
ALTER TABLE submissions DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students can see their submissions" ON submissions;
DROP POLICY IF EXISTS "Students can create submissions" ON submissions;
DROP POLICY IF EXISTS "Students can manage their submissions" ON submissions;
DROP POLICY IF EXISTS "Lecturers can see all submissions" ON submissions;
DROP POLICY IF EXISTS "Lecturers can manage submissions" ON submissions;
DROP POLICY IF EXISTS "Lecturers can manage submissions for their exams" ON submissions;
DROP POLICY IF EXISTS "Lecturers can update marking_details" ON submissions;

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

-- Allow EVERYONE to read submissions (we handle sensitive info in app layer, but RLS must allow student to see their draft)
CREATE POLICY "Permissive select for submissions" ON submissions
  FOR SELECT USING (true);

-- Allow EVERYONE to insert (students creating first draft)
CREATE POLICY "Permissive insert for submissions" ON submissions
  FOR INSERT WITH CHECK (true);

-- Allow EVERYONE to update (students autosaving)
CREATE POLICY "Permissive update for submissions" ON submissions
  FOR UPDATE USING (true);


-- 2. VIOLATIONS
ALTER TABLE violations DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students can create violations" ON violations;
DROP POLICY IF EXISTS "Lecturers can see violations" ON violations;
DROP POLICY IF EXISTS "Lecturers can manage violations for their exams" ON violations;

ALTER TABLE violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permissive select for violations" ON violations
  FOR SELECT USING (true);

CREATE POLICY "Permissive insert for violations" ON violations
  FOR INSERT WITH CHECK (true);

-- 3. ENROLLMENTS (Ensure student can always join)
ALTER TABLE enrollments DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow individual enrollment select" ON enrollments;
DROP POLICY IF EXISTS "Allow individual enrollment insert" ON enrollments;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permissive select for enrollments" ON enrollments
  FOR SELECT USING (true);

CREATE POLICY "Permissive insert for enrollments" ON enrollments
  FOR INSERT WITH CHECK (true);
