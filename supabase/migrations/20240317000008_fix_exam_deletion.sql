-- Fix foreign key constraint for students.exam_id to allow deletion of exams
ALTER TABLE students 
DROP CONSTRAINT IF EXISTS students_exam_id_fkey,
ADD CONSTRAINT students_exam_id_fkey 
  FOREIGN KEY (exam_id) 
  REFERENCES exams(id) 
  ON DELETE SET NULL;

-- Also ensure any other potential blockers are handled (redundant check)
-- questions, submissions, violations, enrollments are already ON DELETE CASCADE
