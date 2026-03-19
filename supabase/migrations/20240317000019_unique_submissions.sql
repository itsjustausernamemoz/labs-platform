-- Prevent duplicate submissions and clean up existing ones

-- 1. Remove duplicates (keep only the latest one per student/exam)
DELETE FROM submissions a
USING submissions b
WHERE a.id < b.id
  AND a.exam_id = b.exam_id
  AND a.student_id = b.student_id;

-- 2. Add unique constraint
ALTER TABLE submissions ADD CONSTRAINT unique_exam_student UNIQUE (exam_id, student_id);

-- 3. Also add indexes if they don't exist (though I added them in 000018)
-- (Migration 000018 already added them, but unique constraint also creates an index)
