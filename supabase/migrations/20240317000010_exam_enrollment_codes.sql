-- Function to generate a random 6-character code
CREATE OR REPLACE FUNCTION generate_enrollment_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Clear characters (no 0, O, I, 1, etc.)
  result TEXT := '';
  i INTEGER := 0;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Add enrollment_code to exams table with a default
ALTER TABLE exams ADD COLUMN IF NOT EXISTS enrollment_code TEXT UNIQUE DEFAULT generate_enrollment_code();

-- Populate any existing rows that might have missed it (if IF NOT EXISTS triggered)
UPDATE exams SET enrollment_code = generate_enrollment_code() WHERE enrollment_code IS NULL;

-- Make it NOT NULL
ALTER TABLE exams ALTER COLUMN enrollment_code SET NOT NULL;
