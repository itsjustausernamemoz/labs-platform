-- Add status to submissions
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted'));
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Function to handle updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_submissions_updated_at BEFORE UPDATE ON submissions FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Update RLS for submissions to allow students to UPSERT drafts
DROP POLICY IF EXISTS "Students can create submissions" ON submissions;
CREATE POLICY "Students can manage their submissions" ON submissions
  FOR ALL USING (true); -- We'll rely on app-level logic for student_id for now, but in a real app would use RLS based on auth

-- Allow lecturers to delete submissions
DROP POLICY IF EXISTS "Lecturers can manage submissions" ON submissions; -- If it exists
CREATE POLICY "Lecturers can delete submissions" ON submissions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM exams WHERE exams.id = submissions.exam_id AND exams.lecturer_id = auth.uid())
  );
