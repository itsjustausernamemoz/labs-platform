-- Hardening Lecturer Isolation
-- migration: 20260413000000_harden_lecturer_isolation.sql

-- 1. Subjects Isolation
-- Drop the overly permissive "Allow full access to subjects" policy
DROP POLICY IF EXISTS "Allow full access to subjects" ON subjects;

-- Create strict isolation policy for subjects
CREATE POLICY "Lecturers can manage their own subjects" ON subjects
FOR ALL TO authenticated
USING (auth.uid() = lecturer_id)
WITH CHECK (auth.uid() = lecturer_id);


-- 2. Exams Isolation Refinement
-- Drop any lingering policies that might be leaked through 'public' or 'all' roles
DROP POLICY IF EXISTS "Anyone can see active exams" ON exams;
DROP POLICY IF EXISTS "Public exam access" ON exams;
DROP POLICY IF EXISTS "Lecturers can see their exams and collaborations" ON exams;
DROP POLICY IF EXISTS "Lecturers see own and collab" ON exams;
DROP POLICY IF EXISTS "Students see active or by code" ON exams;

-- Strict policy for Lecturers: See only their own or collaborations
CREATE POLICY "Lecturers see own and collab" ON exams
FOR SELECT TO authenticated
USING (
  auth.uid() = lecturer_id OR 
  EXISTS (
    SELECT 1 FROM exam_lecturers 
    WHERE exam_lecturers.exam_id = exams.id 
    AND (exam_lecturers.lecturer_email = (auth.jwt() ->> 'email'))
  )
);

-- Strict policy for Students (Anon): Only see ACTIVE exams or those they have a code for
-- Students do NOT log in via Auth Users, so they use the 'anon' role.
CREATE POLICY "Students see active exams" ON exams
FOR SELECT TO anon
USING (is_active = true OR enrollment_code IS NOT NULL);

-- Policy for Lecturers to Manage their own exams (Full Access)
DROP POLICY IF EXISTS "Lecturers can manage their exams" ON exams;
CREATE POLICY "Lecturers can manage their exams" ON exams
FOR ALL TO authenticated
USING (auth.uid() = lecturer_id)
WITH CHECK (auth.uid() = lecturer_id);


-- 3. Questions Hardening
-- Ensure questions are only visible if the exam is visible
DROP POLICY IF EXISTS "Anyone can see questions for active exams" ON questions;
DROP POLICY IF EXISTS "Lecturers can manage questions" ON questions;

CREATE POLICY "View questions" ON questions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM exams 
    WHERE exams.id = questions.exam_id
  )
);

CREATE POLICY "Manage questions" ON questions
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM exams 
    WHERE exams.id = questions.exam_id 
    AND exams.lecturer_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM exams 
    WHERE exams.id = questions.exam_id 
    AND exams.lecturer_id = auth.uid()
  )
);


-- 4. Submissions Hardening
-- Ensure submissions are only accessible to the exam owner or co-markers
DROP POLICY IF EXISTS "Lecturers can see all submissions" ON submissions;
DROP POLICY IF EXISTS "Lecturers can manage submissions for their exams" ON submissions;
DROP POLICY IF EXISTS "Lecturers can delete submissions" ON submissions;

CREATE POLICY "Lecturers manage submissions" ON submissions
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM exams 
    WHERE exams.id = submissions.exam_id 
    AND (
      exams.lecturer_id = auth.uid() OR 
      EXISTS (
        SELECT 1 FROM exam_lecturers 
        WHERE exam_lecturers.exam_id = exams.id 
        AND (exam_lecturers.lecturer_email = (auth.jwt() ->> 'email'))
      )
    )
  )
);

-- Students can still create submissions (Anon)
DROP POLICY IF EXISTS "Students can create submissions" ON submissions;
CREATE POLICY "Students can create submissions" ON submissions
FOR INSERT TO anon
WITH CHECK (
  EXISTS (
    SELECT 1 FROM exams 
    WHERE exams.id = exam_id AND is_active = true
  )
);
