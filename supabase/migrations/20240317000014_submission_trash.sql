-- Create trash box table for deleted submissions
CREATE TABLE IF NOT EXISTS deleted_submissions (
  id UUID PRIMARY KEY,
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  answers JSONB,
  score NUMERIC,
  total_marks INT,
  graded BOOLEAN,
  is_manual BOOLEAN,
  status TEXT,
  marking_details JSONB,
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger function to archive deleted rows
CREATE OR REPLACE FUNCTION archive_submission_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO deleted_submissions (
    id, exam_id, student_id, answers, score, total_marks, 
    graded, is_manual, status, marking_details, submitted_at, updated_at
  )
  VALUES (
    OLD.id, OLD.exam_id, OLD.student_id, OLD.answers, OLD.score, OLD.total_marks, 
    OLD.graded, OLD.is_manual, OLD.status, OLD.marking_details, OLD.submitted_at, OLD.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    deleted_at = NOW(); -- If it was restored and deleted again
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Set up trigger
DROP TRIGGER IF EXISTS archive_submission_trigger ON submissions;
CREATE TRIGGER archive_submission_trigger
BEFORE DELETE ON submissions
FOR EACH ROW
EXECUTE FUNCTION archive_submission_on_delete();

-- RLS for deleted_submissions
ALTER TABLE deleted_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lecturers can manage their deleted submissions" ON deleted_submissions;
CREATE POLICY "Lecturers can manage their deleted submissions" ON deleted_submissions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM exams WHERE exams.id = deleted_submissions.exam_id AND exams.lecturer_id = auth.uid())
  );
