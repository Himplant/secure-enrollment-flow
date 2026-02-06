
-- Step 1: Add super_admin to the admin_role enum
ALTER TYPE public.admin_role ADD VALUE IF NOT EXISTS 'super_admin';
