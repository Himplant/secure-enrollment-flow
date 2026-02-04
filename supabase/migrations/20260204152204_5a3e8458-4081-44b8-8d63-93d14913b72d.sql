-- Create enum for admin roles
CREATE TYPE public.admin_role AS ENUM ('admin', 'viewer');

-- Create admin_users table for invite-only access
CREATE TABLE public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    role admin_role NOT NULL DEFAULT 'viewer',
    invited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.admin_users
        WHERE user_id = _user_id
        AND accepted_at IS NOT NULL
    )
$$;

-- Create function to check if user has specific admin role
CREATE OR REPLACE FUNCTION public.has_admin_role(_user_id UUID, _role admin_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.admin_users
        WHERE user_id = _user_id
        AND role = _role
        AND accepted_at IS NOT NULL
    )
$$;

-- RLS Policies for admin_users
-- Admins can view all admin users
CREATE POLICY "Admins can view admin users"
ON public.admin_users
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- Only admins can invite new users
CREATE POLICY "Admins can invite users"
ON public.admin_users
FOR INSERT
TO authenticated
WITH CHECK (public.has_admin_role(auth.uid(), 'admin'));

-- Only admins can update users
CREATE POLICY "Admins can update users"
ON public.admin_users
FOR UPDATE
TO authenticated
USING (public.has_admin_role(auth.uid(), 'admin'));

-- Only admins can delete users
CREATE POLICY "Admins can delete users"
ON public.admin_users
FOR DELETE
TO authenticated
USING (public.has_admin_role(auth.uid(), 'admin'));

-- Allow users to accept their own invite (update their own row)
CREATE POLICY "Users can accept their invite"
ON public.admin_users
FOR UPDATE
TO authenticated
USING (
    user_id = auth.uid() 
    AND accepted_at IS NULL
)
WITH CHECK (
    user_id = auth.uid()
);

-- Trigger for updated_at
CREATE TRIGGER update_admin_users_updated_at
BEFORE UPDATE ON public.admin_users
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_admin_users_user_id ON public.admin_users(user_id);
CREATE INDEX idx_admin_users_email ON public.admin_users(email);