-- Lecturer Profiles and Strict Isolation

-- 1. Create lecturer_profiles table
CREATE TABLE IF NOT EXISTS lecturer_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE lecturer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecturers can manage their own profile" ON lecturer_profiles;
CREATE POLICY "Lecturers can manage their own profile" ON lecturer_profiles
FOR ALL USING (auth.uid() = id);

DROP POLICY IF EXISTS "Public can view lecturer profiles" ON lecturer_profiles;
CREATE POLICY "Public can view lecturer profiles" ON lecturer_profiles
FOR SELECT USING (true);


-- 2. Fix Exam Isolation (EXAMS Table)
-- Drop the overly permissive public policy
DROP POLICY IF EXISTS "Public exam access" ON exams;
DROP POLICY IF EXISTS "Lecturers can see their exams and collaborations" ON exams;

-- Authenticated policy (Lecturers)
CREATE POLICY "Lecturers see own and collab" ON exams
FOR SELECT TO authenticated
USING (
  auth.uid() = lecturer_id OR 
  EXISTS (
    SELECT 1 FROM exam_lecturers 
    WHERE exam_lecturers.exam_id = exams.id 
    AND (exam_lecturers.lecturer_email = (auth.jwt() ->> 'email'))
  )
);

-- Anon policy (Students)
CREATE POLICY "Students see active or by code" ON exams
FOR SELECT TO anon
USING (
  is_active = true 
  OR enrollment_code IS NOT NULL
);

-- Ensure Lecturers can also insert/update/delete their own exams
DROP POLICY IF EXISTS "Lecturers can manage their exams" ON exams;
CREATE POLICY "Lecturers can manage their exams" ON exams
FOR ALL TO authenticated
USING (auth.uid() = lecturer_id);


-- 3. Add lecturer_name to submissions for better attribution
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS marked_by_name TEXT;
ALTER TABLE deleted_submissions ADD COLUMN IF NOT EXISTS marked_by_name TEXT;
