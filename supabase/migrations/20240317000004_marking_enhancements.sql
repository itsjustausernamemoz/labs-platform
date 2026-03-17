-- Add marking_details to submissions
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS marking_details JSONB DEFAULT '{}'::jsonb;

-- Ensure lecturers can update marking_details for overrides
CREATE POLICY "Lecturers can update marking_details" ON submissions 
FOR UPDATE 
USING (
  EXISTS (SELECT 1 FROM exams WHERE exams.id = submissions.exam_id AND exams.lecturer_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM exams WHERE exams.id = submissions.exam_id AND exams.lecturer_id = auth.uid())
);
