-- Add is_manual to submissions
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT FALSE;
