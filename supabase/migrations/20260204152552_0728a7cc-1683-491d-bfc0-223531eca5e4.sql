-- Drop existing problematic policies
DROP POLICY IF EXISTS "Admins can view admin users" ON public.admin_users;
DROP POLICY IF EXISTS "Users can accept their invite" ON public.admin_users;

-- Create a function to check if a user has a pending invite by email
CREATE OR REPLACE FUNCTION public.has_pending_invite(_user_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.admin_users
        WHERE email = lower(_user_email)
        AND accepted_at IS NULL
    )
$$;

-- Create a function to get pending invite for email (used during accept)
CREATE OR REPLACE FUNCTION public.get_pending_invite_id(_user_email TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id
    FROM public.admin_users
    WHERE email = lower(_user_email)
    AND accepted_at IS NULL
    LIMIT 1
$$;

-- Allow authenticated users to view admin_users if they are an admin OR if they have a pending invite for their email
CREATE POLICY "Users can view admin users"
ON public.admin_users
FOR SELECT
TO authenticated
USING (
    public.is_admin(auth.uid()) 
    OR email = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
);

-- Allow users to accept their own invite by matching email (not user_id since it's null for pending)
CREATE POLICY "Users can accept their invite by email"
ON public.admin_users
FOR UPDATE
TO authenticated
USING (
    email = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    AND accepted_at IS NULL
)
WITH CHECK (
    email = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
);