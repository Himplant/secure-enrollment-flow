CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = _user_id AND accepted_at IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION private.has_admin_role(_user_id uuid, _role public.admin_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = _user_id AND role = _role AND accepted_at IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION private.auth_user_email()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT LOWER(email) FROM auth.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION private.has_pending_invite(_user_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(_user_email) AND accepted_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION private.get_pending_invite_id(_user_email text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT id FROM public.admin_users WHERE email = lower(_user_email) AND accepted_at IS NULL LIMIT 1
$$;

REVOKE ALL ON FUNCTION private.is_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_admin_role(uuid, public.admin_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auth_user_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_pending_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_pending_invite_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_admin_role(uuid, public.admin_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.auth_user_email() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_pending_invite(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_pending_invite_id(text) TO authenticated, service_role;

-- storage.objects
DROP POLICY IF EXISTS "Admins can view consent documents" ON storage.objects;
CREATE POLICY "Admins can view consent documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'consent-documents' AND private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can read consent documents" ON storage.objects;
CREATE POLICY "Admins can read consent documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'consent-documents' AND private.is_admin(auth.uid()));

-- enrollment_events
DROP POLICY IF EXISTS "Admins can view enrollment_events" ON public.enrollment_events;
CREATE POLICY "Admins can view enrollment_events" ON public.enrollment_events
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));

-- enrollments
DROP POLICY IF EXISTS "Admins can view enrollments" ON public.enrollments;
CREATE POLICY "Admins can view enrollments" ON public.enrollments
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can delete enrollments" ON public.enrollments;
CREATE POLICY "Admins can delete enrollments" ON public.enrollments
  FOR DELETE TO authenticated USING (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can update enrollments" ON public.enrollments;
CREATE POLICY "Admins can update enrollments" ON public.enrollments
  FOR UPDATE TO authenticated
  USING (private.is_admin(auth.uid()))
  WITH CHECK (private.is_admin(auth.uid()));

-- admin_users
DROP POLICY IF EXISTS "Users can accept their invite by email" ON public.admin_users;
CREATE POLICY "Users can accept their invite by email" ON public.admin_users
  FOR UPDATE TO authenticated
  USING (email = private.auth_user_email() AND accepted_at IS NULL)
  WITH CHECK (email = private.auth_user_email());
DROP POLICY IF EXISTS "Admins can delete non-super users" ON public.admin_users;
CREATE POLICY "Admins can delete non-super users" ON public.admin_users
  FOR DELETE TO authenticated
  USING (private.has_admin_role(auth.uid(), 'admin'::public.admin_role) AND role <> 'super_admin'::public.admin_role);
DROP POLICY IF EXISTS "Admins can update non-super users" ON public.admin_users;
CREATE POLICY "Admins can update non-super users" ON public.admin_users
  FOR UPDATE TO authenticated
  USING (private.has_admin_role(auth.uid(), 'admin'::public.admin_role) AND role <> 'super_admin'::public.admin_role)
  WITH CHECK (role <> 'super_admin'::public.admin_role);
DROP POLICY IF EXISTS "Super admins can delete users" ON public.admin_users;
CREATE POLICY "Super admins can delete users" ON public.admin_users
  FOR DELETE TO authenticated USING (private.has_admin_role(auth.uid(), 'super_admin'::public.admin_role));
DROP POLICY IF EXISTS "Super admins can update users" ON public.admin_users;
CREATE POLICY "Super admins can update users" ON public.admin_users
  FOR UPDATE TO authenticated USING (private.has_admin_role(auth.uid(), 'super_admin'::public.admin_role));
DROP POLICY IF EXISTS "Admins and super admins can invite users" ON public.admin_users;
CREATE POLICY "Admins and super admins can invite users" ON public.admin_users
  FOR INSERT TO authenticated
  WITH CHECK (private.has_admin_role(auth.uid(), 'admin'::public.admin_role) OR private.has_admin_role(auth.uid(), 'super_admin'::public.admin_role));
DROP POLICY IF EXISTS "Users can view admin users" ON public.admin_users;
CREATE POLICY "Users can view admin users" ON public.admin_users
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()) OR email = private.auth_user_email());

-- patients
DROP POLICY IF EXISTS "Admins can view patients" ON public.patients;
CREATE POLICY "Admins can view patients" ON public.patients
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can insert patients" ON public.patients;
CREATE POLICY "Admins can insert patients" ON public.patients
  FOR INSERT TO authenticated WITH CHECK (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can update patients" ON public.patients;
CREATE POLICY "Admins can update patients" ON public.patients
  FOR UPDATE TO authenticated USING (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can delete patients" ON public.patients;
CREATE POLICY "Admins can delete patients" ON public.patients
  FOR DELETE TO authenticated USING (private.is_admin(auth.uid()));

-- policies
DROP POLICY IF EXISTS "Admins can view policies" ON public.policies;
CREATE POLICY "Admins can view policies" ON public.policies
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can insert policies" ON public.policies;
CREATE POLICY "Admins can insert policies" ON public.policies
  FOR INSERT TO authenticated WITH CHECK (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can update policies" ON public.policies;
CREATE POLICY "Admins can update policies" ON public.policies
  FOR UPDATE TO authenticated USING (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can delete policies" ON public.policies;
CREATE POLICY "Admins can delete policies" ON public.policies
  FOR DELETE TO authenticated USING (private.is_admin(auth.uid()));

-- surgeons
DROP POLICY IF EXISTS "Admins can view surgeons" ON public.surgeons;
CREATE POLICY "Admins can view surgeons" ON public.surgeons
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can insert surgeons" ON public.surgeons;
CREATE POLICY "Admins can insert surgeons" ON public.surgeons
  FOR INSERT TO authenticated WITH CHECK (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can update surgeons" ON public.surgeons;
CREATE POLICY "Admins can update surgeons" ON public.surgeons
  FOR UPDATE TO authenticated USING (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can delete surgeons" ON public.surgeons;
CREATE POLICY "Admins can delete surgeons" ON public.surgeons
  FOR DELETE TO authenticated USING (private.is_admin(auth.uid()));

-- admin_audit_log
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.admin_audit_log;
CREATE POLICY "Admins can view audit logs" ON public.admin_audit_log
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can insert audit logs" ON public.admin_audit_log;
CREATE POLICY "Admins can insert audit logs" ON public.admin_audit_log
  FOR INSERT TO authenticated WITH CHECK (private.is_admin(auth.uid()));

-- surgeon_credits
DROP POLICY IF EXISTS "Admins can view surgeon_credits" ON public.surgeon_credits;
CREATE POLICY "Admins can view surgeon_credits" ON public.surgeon_credits
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can insert surgeon_credits" ON public.surgeon_credits;
CREATE POLICY "Admins can insert surgeon_credits" ON public.surgeon_credits
  FOR INSERT TO authenticated WITH CHECK (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can update surgeon_credits" ON public.surgeon_credits;
CREATE POLICY "Admins can update surgeon_credits" ON public.surgeon_credits
  FOR UPDATE TO authenticated USING (private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can delete surgeon_credits" ON public.surgeon_credits;
CREATE POLICY "Admins can delete surgeon_credits" ON public.surgeon_credits
  FOR DELETE TO authenticated USING (private.is_admin(auth.uid()));

-- Drop the old public wrappers
DROP FUNCTION IF EXISTS public.is_admin(uuid);
DROP FUNCTION IF EXISTS public.has_admin_role(uuid, public.admin_role);
DROP FUNCTION IF EXISTS public.auth_user_email();
DROP FUNCTION IF EXISTS public.has_pending_invite(text);
DROP FUNCTION IF EXISTS public.get_pending_invite_id(text);