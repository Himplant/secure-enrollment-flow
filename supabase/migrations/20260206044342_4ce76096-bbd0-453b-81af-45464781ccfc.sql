-- Fix: Deny public INSERT/UPDATE/DELETE on mfa_email_codes
CREATE POLICY "Deny public insert to mfa_email_codes"
  ON public.mfa_email_codes FOR INSERT
  WITH CHECK (false);

CREATE POLICY "Deny public update to mfa_email_codes"
  ON public.mfa_email_codes FOR UPDATE
  USING (false);

CREATE POLICY "Deny public delete to mfa_email_codes"
  ON public.mfa_email_codes FOR DELETE
  USING (false);

-- Fix: Allow admins to view enrollment_events (audit logs)
CREATE POLICY "Admins can view enrollment_events"
  ON public.enrollment_events FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));