-- Drop the restrictive deny policy for enrollments delete
DROP POLICY IF EXISTS "Deny public delete to enrollments" ON public.enrollments;

-- Create policy allowing admins to delete non-paid enrollments
CREATE POLICY "Admins can delete enrollments"
ON public.enrollments
FOR DELETE
USING (is_admin(auth.uid()));