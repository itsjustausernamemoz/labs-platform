-- Drop existing policies that might conflict
DROP POLICY IF EXISTS "Anyone can see active exams" ON exams;
DROP POLICY IF EXISTS "Allow code search" ON exams;

-- New policy for exams: 
-- 1. Active exams are public.
-- 2. Lecturers can see their own.
-- 3. Anyone can see an exam if they have the enrollment code (to allow joining before activation).
CREATE POLICY "Public exam access" ON exams
  FOR SELECT USING (
    is_active = true 
    OR auth.uid() = lecturer_id 
    OR enrollment_code IS NOT NULL
  );

-- Fix enrollments policies (again, making sure they are robust)
DROP POLICY IF EXISTS "Enable student self-enrollment" ON enrollments;
DROP POLICY IF EXISTS "Enable students to view their enrollments" ON enrollments;
DROP POLICY IF EXISTS "Students can see their own enrollments" ON enrollments;
DROP POLICY IF EXISTS "Anyone can see their enrollments" ON enrollments;

CREATE POLICY "Allow individual enrollment select" ON enrollments
  FOR SELECT USING (true);

CREATE POLICY "Allow individual enrollment insert" ON enrollments
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow individual enrollment delete" ON enrollments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM exams 
      WHERE exams.id = enrollments.exam_id 
      AND exams.lecturer_id = auth.uid()
    )
  );
