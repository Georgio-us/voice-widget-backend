-- Fix Statistics Dates Migration
-- Purpose: Fix text-based created_at with literal 'now()' string and incorrect session_logs date.

BEGIN;

-- 1. Fix lead_requests
UPDATE lead_requests SET created_at = NOW()::text WHERE created_at = 'now()';
ALTER TABLE lead_requests ALTER COLUMN created_at DROP DEFAULT;
ALTER TABLE lead_requests ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE lead_requests ALTER COLUMN created_at SET DEFAULT NOW();

-- 2. Fix session_logs
ALTER TABLE session_logs ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE session_logs ALTER COLUMN created_at SET DEFAULT NOW();

COMMIT;
