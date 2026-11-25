DROP POLICY IF EXISTS "Anyone can read feature flags" ON public.app_feature_flags;
REVOKE SELECT ON public.app_feature_flags FROM anon;
CREATE POLICY "Portal users can read feature flags" ON public.app_feature_flags
  FOR SELECT TO authenticated
  USING (private.is_portal_user(auth.uid()));