
-- Add 'refunded' to the enrollment_status enum
ALTER TYPE public.enrollment_status ADD VALUE IF NOT EXISTS 'refunded';

-- Add refunded_at timestamp column to enrollments
ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS refunded_at timestamp with time zone DEFAULT NULL;
