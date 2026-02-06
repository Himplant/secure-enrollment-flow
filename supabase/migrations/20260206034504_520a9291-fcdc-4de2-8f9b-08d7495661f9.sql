
-- Set ray@himplant.com to super_admin
UPDATE public.admin_users SET role = 'super_admin' WHERE email = 'ray@himplant.com';

-- Drop existing delete policy and replace with one that protects super_admins
DROP POLICY IF EXISTS "Admins can delete users" ON public.admin_users;

CREATE POLICY "Admins can delete non-super users"
ON public.admin_users
FOR DELETE
USING (
  has_admin_role(auth.uid(), 'admin'::admin_role)
  AND role != 'super_admin'
);

-- Prevent changing a super_admin's role
DROP POLICY IF EXISTS "Admins can update users" ON public.admin_users;

CREATE POLICY "Admins can update non-super users"
ON public.admin_users
FOR UPDATE
USING (
  has_admin_role(auth.uid(), 'admin'::admin_role)
  AND role != 'super_admin'
)
WITH CHECK (role != 'super_admin');

-- Super admins can delete and update everyone
CREATE POLICY "Super admins can delete users"
ON public.admin_users
FOR DELETE
USING (has_admin_role(auth.uid(), 'super_admin'::admin_role));

CREATE POLICY "Super admins can update users"
ON public.admin_users
FOR UPDATE
USING (has_admin_role(auth.uid(), 'super_admin'::admin_role));

-- Update invite policy to include super_admins
DROP POLICY IF EXISTS "Admins can invite users" ON public.admin_users;

CREATE POLICY "Admins and super admins can invite users"
ON public.admin_users
FOR INSERT
WITH CHECK (
  has_admin_role(auth.uid(), 'admin'::admin_role)
  OR has_admin_role(auth.uid(), 'super_admin'::admin_role)
);

-- Update view policy to include super_admins
DROP POLICY IF EXISTS "Users can view admin users" ON public.admin_users;

CREATE POLICY "Users can view admin users"
ON public.admin_users
FOR SELECT
USING (
  is_admin(auth.uid())
  OR (email = auth_user_email())
);
