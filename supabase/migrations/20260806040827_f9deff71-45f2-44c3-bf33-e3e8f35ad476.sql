-- 0. Clear international demo data that depends on the clinic/region layer
DELETE FROM public.consultation_tasks;
DELETE FROM public.consultation_events;
DELETE FROM public.consultations;
DELETE FROM public.consultation_patients;
DELETE FROM public.provider_accounts;
DELETE FROM public.portal_memberships;

-- 1. Drop portal policies that reference clinic/region scope helpers
DROP POLICY IF EXISTS "Portal reads in-scope consultations" ON public.consultations;
DROP POLICY IF EXISTS "Portal reads in-scope consultation events" ON public.consultation_events;
DROP POLICY IF EXISTS "Portal reads in-scope consultation patients" ON public.consultation_patients;
DROP POLICY IF EXISTS "Portal reads in-scope consultation tasks" ON public.consultation_tasks;
DROP POLICY IF EXISTS "Portal reads in-scope provider accounts" ON public.provider_accounts;
DROP POLICY IF EXISTS "Portal reads own memberships" ON public.portal_memberships;
DROP POLICY IF EXISTS "Portal users read org peers" ON public.portal_users;

-- 2. Drop the clinic / region layer
DROP TABLE IF EXISTS public.clinic_surgeons CASCADE;
DROP TABLE IF EXISTS public.clinic_distributors CASCADE;
DROP TABLE IF EXISTS public.distributor_regions CASCADE;
DROP TABLE IF EXISTS public.clinics CASCADE;
DROP TABLE IF EXISTS public.regions CASCADE;

DROP FUNCTION IF EXISTS private.portal_scope_clinic_ids(uuid) CASCADE;
DROP FUNCTION IF EXISTS private.portal_scope_region_ids(uuid) CASCADE;
DROP FUNCTION IF EXISTS private.portal_clinic_ids(uuid) CASCADE;
DROP FUNCTION IF EXISTS private.has_portal_role(uuid, portal_role) CASCADE;

-- 3. Surgeons carry the international commercial terms
ALTER TABLE public.surgeons
  ADD COLUMN IF NOT EXISTS consultation_fee_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency character(3),
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS active_provider payment_provider;

-- 4. Repoint consultations at surgeons
ALTER TABLE public.consultations
  DROP COLUMN IF EXISTS clinic_id,
  DROP COLUMN IF EXISTS region_id;
ALTER TABLE public.consultations
  ALTER COLUMN surgeon_id SET NOT NULL;

ALTER TABLE public.provider_accounts DROP COLUMN IF EXISTS clinic_id;
ALTER TABLE public.provider_accounts ALTER COLUMN surgeon_id SET NOT NULL;

ALTER TABLE public.consultation_tasks DROP COLUMN IF EXISTS clinic_id;
ALTER TABLE public.consultation_tasks
  ADD COLUMN IF NOT EXISTS surgeon_id uuid NOT NULL REFERENCES public.surgeons(id) ON DELETE CASCADE;

ALTER TABLE public.international_policies DROP COLUMN IF EXISTS clinic_id;
ALTER TABLE public.international_policies
  ADD COLUMN IF NOT EXISTS surgeon_id uuid REFERENCES public.surgeons(id) ON DELETE CASCADE;

-- 5. Distributor -> surgeon assignments (support / analytics layer only)
CREATE TABLE IF NOT EXISTS public.distributor_surgeons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id uuid NOT NULL REFERENCES public.distributors(id) ON DELETE CASCADE,
  surgeon_id uuid NOT NULL REFERENCES public.surgeons(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (distributor_id, surgeon_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.distributor_surgeons TO authenticated;
GRANT ALL ON public.distributor_surgeons TO service_role;
ALTER TABLE public.distributor_surgeons ENABLE ROW LEVEL SECURITY;

-- 6. Portal org types / roles become surgeon-centric
ALTER TABLE public.portal_memberships
  DROP CONSTRAINT IF EXISTS portal_membership_org_consistency,
  DROP CONSTRAINT IF EXISTS portal_membership_role_matches_org;

ALTER TYPE public.portal_org_type RENAME TO portal_org_type_old;
CREATE TYPE public.portal_org_type AS ENUM ('surgeon', 'distributor');
ALTER TABLE public.portal_memberships
  ALTER COLUMN org_type TYPE public.portal_org_type
  USING (CASE WHEN org_type::text = 'distributor' THEN 'distributor' ELSE 'surgeon' END)::public.portal_org_type;
DROP TYPE public.portal_org_type_old;

ALTER TYPE public.portal_role RENAME TO portal_role_old;
CREATE TYPE public.portal_role AS ENUM (
  'surgeon_admin', 'surgeon_staff', 'surgeon_analyst',
  'distributor_admin', 'distributor_staff', 'distributor_analyst'
);
ALTER TABLE public.portal_memberships
  ALTER COLUMN role TYPE public.portal_role
  USING (CASE
    WHEN role::text = 'clinic_admin' THEN 'surgeon_admin'
    WHEN role::text = 'clinic_staff' THEN 'surgeon_staff'
    WHEN role::text = 'clinic_analyst' THEN 'surgeon_analyst'
    ELSE role::text END)::public.portal_role;
DROP TYPE public.portal_role_old;

ALTER TABLE public.portal_memberships DROP COLUMN IF EXISTS clinic_id;
ALTER TABLE public.portal_memberships
  ADD COLUMN IF NOT EXISTS surgeon_id uuid REFERENCES public.surgeons(id) ON DELETE CASCADE;

ALTER TABLE public.portal_memberships
  ADD CONSTRAINT portal_membership_org_consistency CHECK (
    (org_type = 'distributor' AND distributor_id IS NOT NULL AND surgeon_id IS NULL)
    OR (org_type = 'surgeon' AND surgeon_id IS NOT NULL AND distributor_id IS NULL)
  ),
  ADD CONSTRAINT portal_membership_role_matches_org CHECK (
    (org_type = 'distributor' AND role IN ('distributor_admin','distributor_staff','distributor_analyst'))
    OR (org_type = 'surgeon' AND role IN ('surgeon_admin','surgeon_staff','surgeon_analyst'))
  );

-- 7. Scope helpers
CREATE OR REPLACE FUNCTION private.portal_surgeon_ids(_user uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'private' AS $$
  SELECT pm.surgeon_id
  FROM public.portal_memberships pm
  JOIN public.portal_users pu ON pu.id = pm.portal_user_id
  WHERE pu.user_id = _user AND pu.is_active AND pu.accepted_at IS NOT NULL
    AND pm.is_active AND pm.revoked_at IS NULL
    AND pm.org_type = 'surgeon' AND pm.surgeon_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION private.portal_scope_surgeon_ids(_user uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'private' AS $$
  SELECT s.id FROM public.surgeons s
  WHERE s.id IN (SELECT private.portal_surgeon_ids(_user))
  UNION
  SELECT ds.surgeon_id FROM public.distributor_surgeons ds
  WHERE ds.distributor_id IN (SELECT private.portal_distributor_ids(_user))
$$;

CREATE OR REPLACE FUNCTION private.has_portal_role(_user uuid, _role portal_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'private' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portal_memberships pm
    JOIN public.portal_users pu ON pu.id = pm.portal_user_id
    WHERE pu.user_id = _user AND pu.is_active AND pu.accepted_at IS NOT NULL
      AND pm.is_active AND pm.revoked_at IS NULL AND pm.role = _role
  )
$$;

REVOKE ALL ON FUNCTION private.portal_surgeon_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.portal_scope_surgeon_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.has_portal_role(uuid, portal_role) FROM PUBLIC, anon, authenticated;

-- 8. Rebuild portal read policies on surgeon scope
CREATE POLICY "Portal reads in-scope surgeons" ON public.surgeons
FOR SELECT TO authenticated
USING (id IN (SELECT private.portal_scope_surgeon_ids(auth.uid())));

CREATE POLICY "Portal reads own distributor surgeons" ON public.distributor_surgeons
FOR SELECT TO authenticated
USING (distributor_id IN (SELECT private.portal_distributor_ids(auth.uid())));

CREATE POLICY "Admins manage distributor surgeons" ON public.distributor_surgeons
FOR ALL TO authenticated
USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));

CREATE POLICY "Portal reads in-scope consultations" ON public.consultations
FOR SELECT TO authenticated
USING (surgeon_id IN (SELECT private.portal_scope_surgeon_ids(auth.uid())));

CREATE POLICY "Portal reads in-scope consultation events" ON public.consultation_events
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.consultations c
  WHERE c.id = consultation_events.consultation_id
    AND c.surgeon_id IN (SELECT private.portal_scope_surgeon_ids(auth.uid()))
));

CREATE POLICY "Portal reads in-scope consultation patients" ON public.consultation_patients
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.consultations c
  WHERE c.patient_id = consultation_patients.id
    AND c.surgeon_id IN (SELECT private.portal_scope_surgeon_ids(auth.uid()))
));

CREATE POLICY "Portal reads in-scope consultation tasks" ON public.consultation_tasks
FOR SELECT TO authenticated
USING (surgeon_id IN (SELECT private.portal_scope_surgeon_ids(auth.uid())));

CREATE POLICY "Portal reads in-scope provider accounts" ON public.provider_accounts
FOR SELECT TO authenticated
USING (surgeon_id IN (SELECT private.portal_scope_surgeon_ids(auth.uid())));

CREATE POLICY "Portal reads own memberships" ON public.portal_memberships
FOR SELECT TO authenticated
USING (
  portal_user_id = private.portal_user_id(auth.uid())
  OR surgeon_id IN (SELECT private.portal_surgeon_ids(auth.uid()))
  OR distributor_id IN (SELECT private.portal_distributor_ids(auth.uid()))
);

CREATE POLICY "Portal users read org peers" ON public.portal_users
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.portal_memberships pm
  WHERE pm.portal_user_id = portal_users.id AND pm.is_active AND pm.revoked_at IS NULL
    AND (
      pm.surgeon_id IN (SELECT private.portal_surgeon_ids(auth.uid()))
      OR pm.distributor_id IN (SELECT private.portal_distributor_ids(auth.uid()))
    )
));