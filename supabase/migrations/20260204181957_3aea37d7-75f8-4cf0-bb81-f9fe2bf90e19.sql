
-- Create a SECURITY DEFINER function to safely get the current user's email
-- This avoids the "permission denied for table users" error when used in RLS policies
CREATE OR REPLACE FUNCTION public.auth_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT LOWER(email) FROM auth.users WHERE id = auth.uid()
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.auth_user_email() TO authenticated;

-- Drop and recreate the problematic SELECT policy on admin_users
-- The old policy used inline SQL that queried auth.users directly, causing permission errors
DROP POLICY IF EXISTS "Users can view admin users" ON public.admin_users;

CREATE POLICY "Users can view admin users"
ON public.admin_users
FOR SELECT
TO authenticated
USING (
  is_admin(auth.uid()) 
  OR email = public.auth_user_email()
);

-- Also fix the UPDATE policy that has the same issue
DROP POLICY IF EXISTS "Users can accept their invite by email" ON public.admin_users;

CREATE POLICY "Users can accept their invite by email"
ON public.admin_users
FOR UPDATE
TO authenticated
USING (
  email = public.auth_user_email() 
  AND accepted_at IS NULL
)
WITH CHECK (
  email = public.auth_user_email()
);
