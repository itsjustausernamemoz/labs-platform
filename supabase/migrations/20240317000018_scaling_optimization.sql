-- Scaling Optimization: Indexes for high-traffic tables

-- 1. Submissions indexes
-- Speed up lookup by exam and student (common in ExamRoom)
CREATE INDEX IF NOT EXISTS idx_submissions_exam_student ON submissions(exam_id, student_id);
-- Speed up dashboard lookups for specific student status
CREATE INDEX IF NOT EXISTS idx_submissions_student_status ON submissions(student_id, status);

-- 2. Violations indexes
-- Speed up violation counts per student per exam
CREATE INDEX IF NOT EXISTS idx_violations_exam_student ON violations(exam_id, student_id);

-- 3. Enrollments indexes
-- Speed up enrollment checks
CREATE INDEX IF NOT EXISTS idx_enrollments_exam_student ON enrollments(exam_id, student_id);

-- 4. Questions indexes
-- Speed up question fetching for exams
CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id, order_index);
