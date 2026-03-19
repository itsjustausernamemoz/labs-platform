-- ============================================================
-- Migration 000023: Fix Submission Archive Trigger
-- ============================================================
-- Problem: The archive_submission_on_delete trigger runs as SECURITY INVOKER,
-- meaning it inherits the calling user's RLS context. When a lecturer deletes
-- a submission, the trigger tries to INSERT into deleted_submissions, but RLS
-- on deleted_submissions may block it (especially if the exam_id subquery is
-- evaluated in a restricted context).
--
-- Fix 1: Recreate the trigger function as SECURITY DEFINER so it always runs
--         as the function owner (superuser/postgres), bypassing RLS.
-- Fix 2: Include the marked_by_email and marked_by_name columns that were
--         added in migration 000016 but missed from the trigger's INSERT list.
-- ============================================================

-- Step 1: Add missing columns to deleted_submissions if not already there
ALTER TABLE deleted_submissions
  ADD COLUMN IF NOT EXISTS marked_by_email TEXT,
  ADD COLUMN IF NOT EXISTS marked_by_name  TEXT;

-- Step 2: Replace the trigger function with a SECURITY DEFINER version
--         that also copies the two newly added columns.
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
    deleted_at = NOW();  -- handles restore-then-delete cycles
  RETURN OLD;
END;
$$;

-- Step 3: Recreate the trigger (DROP + CREATE to pick up any definition changes)
DROP TRIGGER IF EXISTS archive_submission_trigger ON submissions;
CREATE TRIGGER archive_submission_trigger
  BEFORE DELETE ON submissions
  FOR EACH ROW
  EXECUTE FUNCTION archive_submission_on_delete();
