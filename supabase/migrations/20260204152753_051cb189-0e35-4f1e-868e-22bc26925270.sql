-- Allow admins to read enrollments (they need this for the dashboard)
CREATE POLICY "Admins can view enrollments"
ON public.enrollments
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));