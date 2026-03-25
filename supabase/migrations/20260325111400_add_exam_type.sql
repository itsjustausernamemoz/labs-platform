-- Add exam_type column to exams table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exam_category') THEN
        CREATE TYPE exam_category AS ENUM ('mcq_only', 'structured_only', 'mixed');
    END IF;
END $$;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS exam_type exam_category DEFAULT 'mixed';
