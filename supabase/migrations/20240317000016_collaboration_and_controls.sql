-- Collaborative Marking & Question Copying Controls

-- 1. Add new columns
ALTER TABLE questions ADD COLUMN IF NOT EXISTS can_copy BOOLEAN DEFAULT FALSE;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS marked_by_email TEXT;
ALTER TABLE deleted_submissions ADD COLUMN IF NOT EXISTS marked_by_email TEXT;

-- 2. Create collaboration table
CREATE TABLE IF NOT EXISTS exam_lecturers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  lecturer_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(exam_id, lecturer_email)
);

-- 3. Update RLS for exams
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lecturers can see their exams and collaborations" ON exams;
CREATE POLICY "Lecturers can see their exams and collaborations" ON exams
FOR SELECT USING (
  auth.uid() = lecturer_id OR 
  EXISTS (
    SELECT 1 FROM exam_lecturers 
    WHERE exam_lecturers.exam_id = exams.id 
    AND (exam_lecturers.lecturer_email = (auth.jwt() ->> 'email'))
  )
);

-- Note: The INSERT/UPDATE/DELETE policy on exams remains restricted to the OWNER (lecturer_id)
-- unless we want co-markers to also edit the exam title/duration. 
-- For now, co-markers only mark.

-- 4. Update RLS for submissions
DROP POLICY IF EXISTS "Lecturers can manage submissions for their exams" ON submissions;
CREATE POLICY "Lecturers can manage submissions for their exams" ON submissions
FOR ALL USING (
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

-- 5. Update RLS for questions
DROP POLICY IF EXISTS "Lecturers can manage questions" ON questions;
CREATE POLICY "Lecturers can manage questions" ON questions
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM exams 
    WHERE exams.id = questions.exam_id 
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
