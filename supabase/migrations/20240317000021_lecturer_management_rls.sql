-- Lecturer Management RLS (Delete & Resumption permissions)

-- 1. SUBMISSIONS: Allow lecturers to delete (moves to trash via trigger)
DROP POLICY IF EXISTS "Lecturers can delete submissions" ON submissions;
CREATE POLICY "Lecturers can delete submissions" ON submissions
  FOR DELETE TO authenticated
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

-- 2. VIOLATIONS: Allow lecturers to delete (to reset student violations)
DROP POLICY IF EXISTS "Lecturers can delete violations" ON violations;
CREATE POLICY "Lecturers can delete violations" ON violations
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM exams 
      WHERE exams.id = violations.exam_id 
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

-- 3. DELETED_SUBMISSIONS: Allow lecturers to manage trash
DROP POLICY IF EXISTS "Lecturers can manage their deleted submissions" ON deleted_submissions;
CREATE POLICY "Lecturers can manage their deleted submissions" ON deleted_submissions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM exams 
      WHERE exams.id = deleted_submissions.exam_id 
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
