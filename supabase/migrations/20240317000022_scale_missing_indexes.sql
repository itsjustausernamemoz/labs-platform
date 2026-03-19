-- ============================================================
-- Migration 000022: Missing Indexes for 1000+ Concurrent Students
-- ============================================================

-- 1. enrollments(student_id)
--    StudentDashboard fetches all enrollments WHERE student_id = ?
--    The existing composite index (exam_id, student_id) cannot serve
--    a query filtered ONLY on student_id. This index closes that gap.
CREATE INDEX IF NOT EXISTS idx_enrollments_student_id
  ON enrollments(student_id);

-- 2. exams(enrollment_code)
--    The "Join by code" flow (StudentDashboard.handleJoinExam) does:
--      SELECT ... FROM exams WHERE enrollment_code = ?
--    With 1000 students all joining at exam-start, this needs a fast
--    lookup. The UNIQUE constraint does NOT exist on enrollment_code,
--    so no implicit index — this is a full-table scan without it.
CREATE INDEX IF NOT EXISTS idx_exams_enrollment_code
  ON exams(enrollment_code)
  WHERE enrollment_code IS NOT NULL;

-- 3. violations(student_id)
--    ExamRoom startup fetches the prior violation COUNT:
--      SELECT count(*) FROM violations WHERE exam_id = ? AND student_id = ?
--    The composite index (exam_id, student_id) covers this perfectly,
--    but violation queries in the lecturer results page also filter
--    by student_id alone. This single-column index speeds that path.
CREATE INDEX IF NOT EXISTS idx_violations_student_id
  ON violations(student_id);

-- 4. exams(id) WHERE is_active = true  (partial index)
--    Questions RLS and StudentDashboard both check is_active frequently.
--    A partial index on active exams dramatically reduces the scan set
--    since at any given moment only a handful of exams are active.
CREATE INDEX IF NOT EXISTS idx_exams_active
  ON exams(id)
  WHERE is_active = true;
