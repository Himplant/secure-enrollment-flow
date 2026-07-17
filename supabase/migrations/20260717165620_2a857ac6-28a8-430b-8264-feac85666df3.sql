-- SECURITY: restrict "Service role manages consent documents" policy to service_role
-- (was applied to public role, which was overly permissive)
DROP POLICY IF EXISTS "Service role manages consent documents" ON storage.objects;
CREATE POLICY "Service role manages consent documents"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'consent-documents')
  WITH CHECK (bucket_id = 'consent-documents');

-- SECURITY: revoke public/anon EXECUTE on SECURITY DEFINER functions.
-- Trigger-only functions get EXECUTE revoked entirely (triggers run in the table owner's context).
-- RLS-helper functions keep EXECUTE for authenticated because RLS evaluation checks
-- the calling role's EXECUTE permission.

REVOKE EXECUTE ON FUNCTION public.has_admin_role(uuid, public.admin_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_pending_invite(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_pending_invite_id(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_user_email() FROM PUBLIC, anon;

-- Trigger-only functions: no callers need EXECUTE
REVOKE EXECUTE ON FUNCTION public.ensure_single_default_policy() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;