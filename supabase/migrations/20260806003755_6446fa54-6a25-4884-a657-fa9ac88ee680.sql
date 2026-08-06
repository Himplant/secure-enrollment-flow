-- Trigger-only function must not be callable by API roles
REVOKE ALL ON FUNCTION public.enforce_consultation_immutability() FROM PUBLIC, anon, authenticated;

-- Explicit deny-all policy on the private credential store (service_role bypasses RLS)
CREATE POLICY "No API access to provider credentials" ON private.provider_credentials
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);