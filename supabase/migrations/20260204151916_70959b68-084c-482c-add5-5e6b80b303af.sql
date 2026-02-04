-- SECURITY FIX: Add missing INSERT, UPDATE, DELETE RLS policies
-- The enrollments and enrollment_events tables only have SELECT policies
-- This creates complete restrictive policies to deny all public write access

-- Enrollments table: Add missing INSERT, UPDATE, DELETE policies
CREATE POLICY "Deny public insert to enrollments"
  ON public.enrollments 
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "Deny public update to enrollments"
  ON public.enrollments 
  FOR UPDATE
  USING (false);

CREATE POLICY "Deny public delete to enrollments"
  ON public.enrollments 
  FOR DELETE
  USING (false);

-- Enrollment events table: Add missing INSERT, UPDATE, DELETE policies
CREATE POLICY "Deny public insert to enrollment_events"
  ON public.enrollment_events 
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "Deny public update to enrollment_events"
  ON public.enrollment_events 
  FOR UPDATE
  USING (false);

CREATE POLICY "Deny public delete to enrollment_events"
  ON public.enrollment_events 
  FOR DELETE
  USING (false);