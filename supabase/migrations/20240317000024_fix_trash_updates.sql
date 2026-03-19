-- ============================================================
-- Migration 000024: Fix Trash Updates
-- ============================================================
-- Problem: When a lecturer deletes a submission, the student can submit again 
-- (creating a new row with the SAME id, because ExamRoom cached it). If the 
-- lecturer deletes that SECOND submission, the ON CONFLICT clause in the 
-- archive trigger only updated the `deleted_at` timestamp but did NOT replace
-- the actual answers, scores, and status with the newer ones!
--
-- Fix: Make the ON CONFLICT DO UPDATE clause update ALL submission columns 
-- so the trash box accurately reflects the most recent deleted data.
-- ============================================================

CREATE OR REPLACE FUNCTION archive_submission_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as function owner, bypasses RLS on deleted_submissions
SET search_path = public
AS $$
BEGIN
  INSERT INTO deleted_submissions (
    id, exam_id, student_id, answers, score, total_marks,
    graded, is_manual, status, marking_details,
    submitted_at, updated_at,
    marked_by_email, marked_by_name
  )
  VALUES (
    OLD.id, OLD.exam_id, OLD.student_id, OLD.answers, OLD.score, OLD.total_marks,
    OLD.graded, OLD.is_manual, OLD.status, OLD.marking_details,
    OLD.submitted_at, OLD.updated_at,
    OLD.marked_by_email, OLD.marked_by_name
  )
  ON CONFLICT (id) DO UPDATE SET
    answers = EXCLUDED.answers,
    score = EXCLUDED.score,
    total_marks = EXCLUDED.total_marks,
    graded = EXCLUDED.graded,
    is_manual = EXCLUDED.is_manual,
    status = EXCLUDED.status,
    marking_details = EXCLUDED.marking_details,
    submitted_at = EXCLUDED.submitted_at,
    updated_at = EXCLUDED.updated_at,
    marked_by_email = EXCLUDED.marked_by_email,
    marked_by_name = EXCLUDED.marked_by_name,
    deleted_at = NOW();  -- handles restore-then-delete cycles

  -- Automatically wipe all security violations for this student + exam attempt
  -- so they are guaranteed a completely fresh start, even if deleted via raw SQL.
  DELETE FROM violations 
  WHERE student_id = OLD.student_id AND exam_id = OLD.exam_id;

  RETURN OLD;
END;
$$;
