-- Add new settings columns to exams table
ALTER TABLE exams
ADD COLUMN IF NOT EXISTS total_marks INT DEFAULT 100,
ADD COLUMN IF NOT EXISTS default_marks_per_question INT DEFAULT 1,
ADD COLUMN IF NOT EXISTS allowed_violations INT DEFAULT 3;
