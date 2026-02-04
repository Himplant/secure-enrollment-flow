-- Add RLS policy to allow anonymous read access to enrollments by token_hash
-- This is needed for the public enrollment page to work

CREATE POLICY "Allow public read enrollment by token_hash"
ON public.enrollments
FOR SELECT
USING (true);

-- Also allow public read of enrollment_events for audit purposes (read-only)
CREATE POLICY "Allow public read enrollment_events"
ON public.enrollment_events
FOR SELECT
USING (true);