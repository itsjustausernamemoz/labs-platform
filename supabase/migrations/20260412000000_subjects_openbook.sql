-- Subjects + Open Book Mode
-- Folded in from the loose, never-applied supabase/migration_subjects_openbook.sql so a fresh
-- database gets this before 20260413000000_harden_lecturer_isolation.sql, which already assumes
-- the `subjects` table exists (it modifies policies on it).

-- 1. Create subjects table
CREATE TABLE IF NOT EXISTS subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  lecturer_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;

-- Starting policy (superseded by 20260413000000_harden_lecturer_isolation.sql, kept here only so
-- the table matches the loose file's original history for anyone diffing against it).
DROP POLICY IF EXISTS "Allow full access to subjects" ON subjects;
CREATE POLICY "Allow full access to subjects" ON subjects
  FOR ALL USING (true) WITH CHECK (true);

-- 2. Add subject_id column to exams (nullable FK)
ALTER TABLE exams ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL DEFAULT NULL;

-- 3. Add exam_mode column to exams (closed_book by default)
ALTER TABLE exams ADD COLUMN IF NOT EXISTS exam_mode TEXT DEFAULT 'closed_book';

-- 4. Add coding assessment configuration
ALTER TABLE exams ADD COLUMN IF NOT EXISTS has_coding BOOLEAN DEFAULT FALSE;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS coding_language TEXT DEFAULT NULL; -- e.g. 'kotlin', 'python'
