-- SECURITY FIX: Drop the enrollments_public view as it exposes patient data
-- The application uses the get-enrollment edge function for secure token-based access
-- This view is not needed and creates unnecessary exposure

DROP VIEW IF EXISTS public.enrollments_public;