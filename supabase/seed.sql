-- Seed file for initial testing
-- Note: Lecturer must still sign up via Supabase Auth to get a valid UUID

-- Create a sample student
INSERT INTO students (student_number) VALUES ('20240001');

-- Create a sample exam (This would normally be done via the UI)
-- INSERT INTO exams (title, lecturer_id, duration_minutes, is_active)
-- VALUES ('Sample Security Exam', 'REPLACE_WITH_LECTURER_ID', 60, true);
