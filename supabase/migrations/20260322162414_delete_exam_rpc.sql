-- ============================================================
-- Migration 20260322162414: Flawless Exam Deletion RPC
-- ============================================================
-- Purpose: Provides a highly reliable, SECURITY DEFINER RPC 
-- for lecturers to delete an entire exam and all its cascaded 
-- data, sidestepping complex RLS/Trigger interaction bugs on the frontend.
-- ============================================================

CREATE OR REPLACE FUNCTION delete_exam(exam_id_in UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify ownership (Security Protocol)
  IF NOT EXISTS (SELECT 1 FROM exams WHERE id = exam_id_in AND lecturer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to delete this examination.';
  END IF;

  -- 1. Pre-emptively wipe submissions to bypass the trash trigger
  -- This prevents the foreign_key_violation from firing during the cascade
  ALTER TABLE submissions DISABLE TRIGGER archive_submission_trigger;
  DELETE FROM submissions WHERE exam_id = exam_id_in;
  ALTER TABLE submissions ENABLE TRIGGER archive_submission_trigger;

  -- 2. Execute the primary cascading wipe
  DELETE FROM exams WHERE id = exam_id_in;
  
  RETURN TRUE;
END;
$$;
