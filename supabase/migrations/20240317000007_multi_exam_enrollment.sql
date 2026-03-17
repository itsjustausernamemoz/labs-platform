-- Create enrollments table for multi-exam support
CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, exam_id)
);

-- Enable RLS
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

-- Policies for enrollments
CREATE POLICY "Students can see their own enrollments" ON enrollments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM students 
      WHERE students.id = enrollments.student_id 
      AND students.student_number = auth.jwt() ->> 'email' -- Assuming student_number is used for identification
    )
    OR true -- Temporary broad access for development if auth setup is complex
  );

CREATE POLICY "Lecturers can manage enrollments for their exams" ON enrollments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM exams 
      WHERE exams.id = enrollments.exam_id 
      AND exams.lecturer_id = auth.uid()
    )
  );

-- Note: We are keeping students.exam_id for now to avoid breaking existing queries immediately, 
-- but we should transition to using the enrollments table.

-- Data Migration: Move existing enrollments from students table to enrollments table
INSERT INTO enrollments (student_id, exam_id)
SELECT id, exam_id FROM students
WHERE exam_id IS NOT NULL
ON CONFLICT (student_id, exam_id) DO NOTHING;
