-- Add allowed_attempts to exams
ALTER TABLE exams ADD COLUMN IF NOT EXISTS allowed_attempts INT DEFAULT 1;

-- Add attempt_number to submissions
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS attempt_number INT DEFAULT 1;

-- Update the unique constraint on submissions to allow multiple attempts
-- 1. Drop the old constraint
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS unique_exam_student;

-- 2. Add the new multi-attempt constraint
ALTER TABLE submissions ADD CONSTRAINT unique_exam_student_attempt UNIQUE (exam_id, student_id, attempt_number);
