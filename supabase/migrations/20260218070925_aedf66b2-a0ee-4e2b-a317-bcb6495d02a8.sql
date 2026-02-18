-- Add owner_name column to enrollments table
ALTER TABLE public.enrollments ADD COLUMN owner_name text;

-- Add index for filtering by owner
CREATE INDEX idx_enrollments_owner_name ON public.enrollments (owner_name);