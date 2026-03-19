-- Fix lecturer permissions for submissions
-- Ensure lecturers can select, update, and delete submissions for their own exams

-- 1. Drop old restrictive policies if they exist
DROP POLICY IF EXISTS "Lecturers can see all submissions" ON submissions;
DROP POLICY IF EXISTS "Lecturers can update marking_details" ON submissions;
DROP POLICY IF EXISTS "Lecturers can delete submissions" ON submissions;

-- 2. Create a unified management policy for lecturers
CREATE POLICY "Lecturers can manage submissions for their exams" ON submissions
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM exams 
    WHERE exams.id = submissions.exam_id 
    AND exams.lecturer_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM exams 
    WHERE exams.id = submissions.exam_id 
    AND exams.lecturer_id = auth.uid()
  )
);

-- Similarly for violations (to allow lecturers to see them)
DROP POLICY IF EXISTS "Lecturers can see violations" ON violations;
CREATE POLICY "Lecturers can manage violations for their exams" ON violations
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM exams 
    WHERE exams.id = violations.exam_id 
    AND exams.lecturer_id = auth.uid()
  )
);
