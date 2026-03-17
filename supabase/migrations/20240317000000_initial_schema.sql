-- Create exams table
CREATE TABLE IF NOT EXISTS exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  lecturer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  duration_minutes INT DEFAULT 60,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create students table
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_number TEXT UNIQUE NOT NULL,
  exam_id UUID REFERENCES exams(id), -- Direct link for accessibility
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create questions table
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('mcq', 'structured')),
  question_text TEXT NOT NULL,
  options JSONB, -- MCQ: ["A. ...", "B. ...", ...]
  correct_answer TEXT, -- MCQ: 'B'; Structured: model answer
  marks INT DEFAULT 1,
  order_index INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create submissions table
CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  answers JSONB DEFAULT '{}'::jsonb, -- { question_id: answer_text }
  score NUMERIC DEFAULT 0,
  total_marks INT DEFAULT 0,
  graded BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create violations table
CREATE TABLE IF NOT EXISTS violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  violation_type TEXT CHECK (violation_type IN ('tab_switch', 'fullscreen_exit', 'blur')),
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;

-- Policies for students
CREATE POLICY "Students can see themselves" ON students FOR SELECT USING (true);
CREATE POLICY "Public can create student" ON students FOR INSERT WITH CHECK (true);

-- Policies for exams
CREATE POLICY "Anyone can see active exams" ON exams FOR SELECT USING (is_active = true OR (auth.uid() = lecturer_id));
CREATE POLICY "Lecturers can manage their exams" ON exams FOR ALL USING (auth.uid() = lecturer_id);

-- Policies for questions
CREATE POLICY "Anyone can see questions for active exams" ON questions FOR SELECT USING (
  EXISTS (SELECT 1 FROM exams WHERE exams.id = questions.exam_id AND (exams.is_active = true OR exams.lecturer_id = auth.uid()))
);
CREATE POLICY "Lecturers can manage questions" ON questions FOR ALL USING (
  EXISTS (SELECT 1 FROM exams WHERE exams.id = questions.exam_id AND exams.lecturer_id = auth.uid())
);

-- Policies for submissions
CREATE POLICY "Students can see their submissions" ON submissions FOR SELECT USING (true);
CREATE POLICY "Students can create submissions" ON submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Lecturers can see all submissions" ON submissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM exams WHERE exams.id = submissions.exam_id AND exams.lecturer_id = auth.uid())
);

-- Policies for violations
CREATE POLICY "Students can create violations" ON violations FOR INSERT WITH CHECK (true);
CREATE POLICY "Lecturers can see violations" ON violations FOR SELECT USING (
  EXISTS (SELECT 1 FROM exams WHERE exams.id = violations.exam_id AND exams.lecturer_id = auth.uid())
);
