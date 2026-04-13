-- SecureLab Migration: Subjects + Open Book Mode
-- Run this in Supabase SQL Editor

-- 1. Create subjects table
CREATE TABLE IF NOT EXISTS subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  lecturer_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on subjects
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access to subjects
CREATE POLICY "Allow full access to subjects" ON subjects
  FOR ALL USING (true) WITH CHECK (true);

-- 2. Add subject_id column to exams (nullable FK)
ALTER TABLE exams ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL DEFAULT NULL;

-- 3. Add exam_mode column to exams (closed_book by default)
ALTER TABLE exams ADD COLUMN IF NOT EXISTS exam_mode TEXT DEFAULT 'closed_book';

-- 4. Add coding assessment configuration
ALTER TABLE exams ADD COLUMN IF NOT EXISTS has_coding BOOLEAN DEFAULT FALSE;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS coding_language TEXT DEFAULT NULL; -- e.g. 'kotlin', 'python'
