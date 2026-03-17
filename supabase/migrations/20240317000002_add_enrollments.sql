-- Create enrollments table
CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(exam_id, student_id)
);

ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lecturers can manage enrollments" ON enrollments FOR ALL USING (
  EXISTS (SELECT 1 FROM exams WHERE exams.id = enrollments.exam_id AND exams.lecturer_id = auth.uid())
);

CREATE POLICY "Students can see their enrollments" ON enrollments FOR SELECT USING (true);
