-- Allow students to enroll themselves
CREATE POLICY "Enable student self-enrollment" ON enrollments
  FOR INSERT WITH CHECK (true);

-- Ensure students can see their own enrollments
DROP POLICY IF EXISTS "Students can see their own enrollments" ON enrollments;
CREATE POLICY "Enable students to view their enrollments" ON enrollments
  FOR SELECT USING (true);
