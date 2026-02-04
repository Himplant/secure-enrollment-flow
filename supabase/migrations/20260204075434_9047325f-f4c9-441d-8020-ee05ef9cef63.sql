-- SECURITY FIX: Remove overly permissive RLS policies that expose patient PII
-- This migration restricts access to enrollments and enrollment_events tables

-- Step 1: Drop the existing overly permissive policies
DROP POLICY IF EXISTS "Allow public read enrollment by token_hash" ON public.enrollments;
DROP POLICY IF EXISTS "Allow public read enrollment_events" ON public.enrollment_events;

-- Step 2: Create restrictive policies - deny all direct public access
-- Service role (edge functions) will still have full access

-- For enrollments: No direct public read access
-- All access must go through edge functions or secure views
CREATE POLICY "Deny public access to enrollments"
  ON public.enrollments 
  FOR SELECT
  USING (false);

-- For enrollment_events: No direct public read access  
CREATE POLICY "Deny public access to enrollment_events"
  ON public.enrollment_events 
  FOR SELECT
  USING (false);

-- Step 3: Create a secure view that only exposes non-sensitive enrollment fields
-- This view will be used by the frontend after token validation via edge function
CREATE OR REPLACE VIEW public.enrollments_public
WITH (security_invoker = on) AS
SELECT 
  id,
  -- Expose only first name or masked version for display
  CASE 
    WHEN patient_name IS NOT NULL THEN split_part(patient_name, ' ', 1)
    ELSE NULL
  END as patient_first_name,
  amount_cents,
  currency,
  status,
  expires_at,
  terms_version,
  terms_url,
  privacy_url,
  terms_sha256,
  opened_at,
  created_at
  -- EXCLUDED: patient_email, patient_phone, token_hash, token_last4,
  -- stripe_*, zoho_*, terms_accept_ip, terms_accept_user_agent
FROM public.enrollments;

-- Step 4: Create a secure edge function for token-based access
-- The frontend will call an edge function that validates the token
-- and returns only the necessary data

-- Step 5: Add RLS policies for processed_stripe_events (currently no policies)
-- This table should only be accessible by service role
CREATE POLICY "Deny public access to processed_stripe_events"
  ON public.processed_stripe_events 
  FOR SELECT
  USING (false);

CREATE POLICY "Deny public insert to processed_stripe_events"
  ON public.processed_stripe_events 
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "Deny public update to processed_stripe_events"
  ON public.processed_stripe_events 
  FOR UPDATE
  USING (false);

CREATE POLICY "Deny public delete to processed_stripe_events"
  ON public.processed_stripe_events 
  FOR DELETE
  USING (false);