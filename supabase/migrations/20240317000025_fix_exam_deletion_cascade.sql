-- ============================================================
-- Migration 000025: Fix Database Exam Deletion Cascade
-- ============================================================
-- Problem: When a lecturer deletes an entire exam from `exams`, Postgres cascades
-- the delete to `submissions`. The BEFORE DELETE trigger on `submissions` then
-- tries to INSERT the record into `deleted_submissions`. However, because the parent
-- `exam` row is in the middle of being deleted, the INSERT into the trash table
-- fires a FOREIGN KEY CONSTRAINT VIOLATION, causing the entire exam deletion to fail!
--
-- Fix: We wrap the INSERT block in a BEGIN/EXCEPTION block. If a foreign_key_violation
-- occurs (meaning the parent exam or student is being deleted via cascade), we
-- simply ignore it and let the submission be permanently destroyed without trashing it.
-- ============================================================

CREATE OR REPLACE FUNCTION archive_submission_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as function owner, bypasses RLS on deleted_submissions
SET search_path = public
AS $$
BEGIN
  -- Try to move the submission to the trash box
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
  EXCEPTION WHEN foreign_key_violation THEN
    -- If the parent exam or student is currently being deleted via CASCADE,
    -- this INSERT will raise a foreign_key_violation. We simply swallow
    -- the error and do nothing, allowing the submission to be permanently wiped
    -- without going to the trash box (since the entire exam is being destroyed anyway).
    NULL;
  END;

  -- Ensure we wipe violations synchronously if the submission is deleted natively
  -- We wrap this in an exception block too, just in case.
  BEGIN
    DELETE FROM violations 
    WHERE student_id = OLD.student_id AND exam_id = OLD.exam_id;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN OLD;
END;
$$;
