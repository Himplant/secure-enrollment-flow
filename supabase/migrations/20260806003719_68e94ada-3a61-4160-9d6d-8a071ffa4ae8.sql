-- ============================================================
-- M1: International-specific enums (no existing enum touched)
-- ============================================================
CREATE TYPE public.intl_country AS ENUM ('MX', 'CO', 'CL');

CREATE TYPE public.portal_org_type AS ENUM ('distributor', 'clinic');

CREATE TYPE public.portal_role AS ENUM (
  'distributor_admin', 'distributor_staff', 'distributor_analyst',
  'clinic_admin', 'clinic_staff', 'clinic_analyst'
);

CREATE TYPE public.payment_provider AS ENUM ('mercado_pago', 'paypal', 'test', 'stripe_connect');

CREATE TYPE public.provider_account_status AS ENUM (
  'pending', 'onboarding', 'connected', 'expired', 'revoked', 'disabled'
);

CREATE TYPE public.provider_connection_method AS ENUM ('oauth', 'partner_onboarding', 'admin_managed');

CREATE TYPE public.intl_payment_status AS ENUM (
  'draft', 'link_created', 'link_sent', 'link_opened',
  'processing', 'approved', 'failed', 'expired', 'canceled', 'refunded', 'disputed'
);

CREATE TYPE public.intl_consultation_status AS ENUM (
  'draft', 'awaiting_payment', 'awaiting_clinic_contact', 'patient_contacted',
  'scheduled', 'rescheduled', 'completed', 'no_show',
  'patient_canceled', 'clinic_canceled', 'closed_lost'
);

CREATE TYPE public.intl_surgery_status AS ENUM (
  'none', 'recommended', 'scheduled', 'completed', 'declined'
);

CREATE TYPE public.intl_outbox_status AS ENUM ('pending', 'sent', 'failed', 'dead');

-- ============================================================
-- M2: Feature flags (all default false)
-- ============================================================
CREATE TABLE public.app_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_feature_flags TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.app_feature_flags TO authenticated;
GRANT ALL ON public.app_feature_flags TO service_role;
ALTER TABLE public.app_feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read feature flags" ON public.app_feature_flags
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage feature flags" ON public.app_feature_flags
  FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE TRIGGER update_app_feature_flags_updated_at BEFORE UPDATE ON public.app_feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.app_feature_flags (key, description) VALUES
  ('international_module_enabled', 'Master switch for the International Consultations module'),
  ('international_mexico_enabled', 'Allow consultations in Mexico'),
  ('international_colombia_enabled', 'Allow consultations in Colombia'),
  ('international_chile_enabled', 'Allow consultations in Chile'),
  ('mercado_pago_enabled', 'Allow Mercado Pago as a payment provider'),
  ('paypal_enabled', 'Allow PayPal as a payment provider'),
  ('surgeon_portal_enabled', 'Allow surgeon / clinic portal access'),
  ('distributor_portal_enabled', 'Allow distributor portal access'),
  ('test_provider_enabled', 'Allow the non-production simulated payment provider');

-- ============================================================
-- M3: Regions and distributors
-- ============================================================
CREATE TABLE public.regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country public.intl_country NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regions_country_code_unique UNIQUE (country, code)
);
CREATE INDEX idx_regions_country ON public.regions (country);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.regions TO authenticated;
GRANT ALL ON public.regions TO service_role;
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_regions_updated_at BEFORE UPDATE ON public.regions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.distributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  primary_contact_email text,
  primary_contact_phone text,
  is_active boolean NOT NULL DEFAULT true,
  zoho_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distributors_name_unique UNIQUE (name)
);
CREATE UNIQUE INDEX idx_distributors_zoho_id ON public.distributors (zoho_id) WHERE zoho_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.distributors TO authenticated;
GRANT ALL ON public.distributors TO service_role;
ALTER TABLE public.distributors ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_distributors_updated_at BEFORE UPDATE ON public.distributors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.distributor_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id uuid NOT NULL REFERENCES public.distributors(id) ON DELETE CASCADE,
  region_id uuid NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distributor_regions_unique UNIQUE (distributor_id, region_id)
);
CREATE INDEX idx_distributor_regions_distributor ON public.distributor_regions (distributor_id);
CREATE INDEX idx_distributor_regions_region ON public.distributor_regions (region_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.distributor_regions TO authenticated;
GRANT ALL ON public.distributor_regions TO service_role;
ALTER TABLE public.distributor_regions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- M4: Clinics and their links
-- ============================================================
CREATE TABLE public.clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country public.intl_country NOT NULL,
  region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL,
  city text,
  timezone text NOT NULL DEFAULT 'UTC',
  default_currency char(3) NOT NULL DEFAULT 'USD',
  contact_email text,
  contact_phone text,
  address text,
  active_provider public.payment_provider,
  is_active boolean NOT NULL DEFAULT true,
  zoho_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_clinics_country ON public.clinics (country);
CREATE INDEX idx_clinics_region ON public.clinics (region_id);
CREATE UNIQUE INDEX idx_clinics_zoho_id ON public.clinics (zoho_id) WHERE zoho_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinics TO authenticated;
GRANT ALL ON public.clinics TO service_role;
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_clinics_updated_at BEFORE UPDATE ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.clinic_distributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  distributor_id uuid NOT NULL REFERENCES public.distributors(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_distributors_unique UNIQUE (clinic_id, distributor_id)
);
CREATE UNIQUE INDEX idx_clinic_distributors_primary ON public.clinic_distributors (clinic_id) WHERE is_primary;
CREATE INDEX idx_clinic_distributors_distributor ON public.clinic_distributors (distributor_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_distributors TO authenticated;
GRANT ALL ON public.clinic_distributors TO service_role;
ALTER TABLE public.clinic_distributors ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.clinic_surgeons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  surgeon_id uuid NOT NULL REFERENCES public.surgeons(id) ON DELETE CASCADE,
  consultation_fee_minor integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_surgeons_unique UNIQUE (clinic_id, surgeon_id)
);
CREATE INDEX idx_clinic_surgeons_surgeon ON public.clinic_surgeons (surgeon_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_surgeons TO authenticated;
GRANT ALL ON public.clinic_surgeons TO service_role;
ALTER TABLE public.clinic_surgeons ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_clinic_surgeons_updated_at BEFORE UPDATE ON public.clinic_surgeons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- M5: Portal identity (fully separate from admin_users)
-- ============================================================
CREATE TABLE public.portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  mfa_required boolean NOT NULL DEFAULT false,
  invited_by uuid,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_portal_users_email ON public.portal_users (lower(email));
CREATE UNIQUE INDEX idx_portal_users_user_id ON public.portal_users (user_id) WHERE user_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_users TO authenticated;
GRANT ALL ON public.portal_users TO service_role;
ALTER TABLE public.portal_users ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_portal_users_updated_at BEFORE UPDATE ON public.portal_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.portal_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  org_type public.portal_org_type NOT NULL,
  distributor_id uuid REFERENCES public.distributors(id) ON DELETE CASCADE,
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE CASCADE,
  role public.portal_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_membership_org_consistency CHECK (
    (org_type = 'distributor' AND distributor_id IS NOT NULL AND clinic_id IS NULL)
    OR
    (org_type = 'clinic' AND clinic_id IS NOT NULL AND distributor_id IS NULL)
  ),
  CONSTRAINT portal_membership_role_matches_org CHECK (
    (org_type = 'distributor' AND role IN ('distributor_admin','distributor_staff','distributor_analyst'))
    OR
    (org_type = 'clinic' AND role IN ('clinic_admin','clinic_staff','clinic_analyst'))
  )
);
CREATE UNIQUE INDEX idx_portal_memberships_unique
  ON public.portal_memberships (portal_user_id, org_type, COALESCE(distributor_id, clinic_id), role);
CREATE INDEX idx_portal_memberships_user ON public.portal_memberships (portal_user_id);
CREATE INDEX idx_portal_memberships_clinic ON public.portal_memberships (clinic_id) WHERE clinic_id IS NOT NULL;
CREATE INDEX idx_portal_memberships_distributor ON public.portal_memberships (distributor_id) WHERE distributor_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_memberships TO authenticated;
GRANT ALL ON public.portal_memberships TO service_role;
ALTER TABLE public.portal_memberships ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_portal_memberships_updated_at BEFORE UPDATE ON public.portal_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- M6: Private scope helper functions (SECURITY DEFINER)
-- ============================================================
CREATE OR REPLACE FUNCTION private.portal_user_id(_user uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT pu.id FROM public.portal_users pu
  WHERE pu.user_id = _user AND pu.is_active AND pu.accepted_at IS NOT NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.portal_distributor_ids(_user uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT pm.distributor_id
  FROM public.portal_memberships pm
  JOIN public.portal_users pu ON pu.id = pm.portal_user_id
  WHERE pu.user_id = _user AND pu.is_active AND pu.accepted_at IS NOT NULL
    AND pm.is_active AND pm.revoked_at IS NULL
    AND pm.org_type = 'distributor' AND pm.distributor_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION private.portal_clinic_ids(_user uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT pm.clinic_id
  FROM public.portal_memberships pm
  JOIN public.portal_users pu ON pu.id = pm.portal_user_id
  WHERE pu.user_id = _user AND pu.is_active AND pu.accepted_at IS NOT NULL
    AND pm.is_active AND pm.revoked_at IS NULL
    AND pm.org_type = 'clinic' AND pm.clinic_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION private.portal_scope_clinic_ids(_user uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT c.id FROM public.clinics c
  WHERE c.id IN (SELECT private.portal_clinic_ids(_user))
  UNION
  SELECT cd.clinic_id FROM public.clinic_distributors cd
  WHERE cd.distributor_id IN (SELECT private.portal_distributor_ids(_user))
  UNION
  SELECT c2.id FROM public.clinics c2
  JOIN public.distributor_regions dr ON dr.region_id = c2.region_id
  WHERE dr.distributor_id IN (SELECT private.portal_distributor_ids(_user))
$$;

CREATE OR REPLACE FUNCTION private.portal_scope_region_ids(_user uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT dr.region_id FROM public.distributor_regions dr
  WHERE dr.distributor_id IN (SELECT private.portal_distributor_ids(_user))
  UNION
  SELECT c.region_id FROM public.clinics c
  WHERE c.id IN (SELECT private.portal_clinic_ids(_user)) AND c.region_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION private.has_portal_role(_user uuid, _role public.portal_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portal_memberships pm
    JOIN public.portal_users pu ON pu.id = pm.portal_user_id
    WHERE pu.user_id = _user AND pu.is_active AND pu.accepted_at IS NOT NULL
      AND pm.is_active AND pm.revoked_at IS NULL AND pm.role = _role
  )
$$;

CREATE OR REPLACE FUNCTION private.is_portal_user(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portal_users pu
    WHERE pu.user_id = _user AND pu.is_active AND pu.accepted_at IS NOT NULL
  )
$$;

REVOKE ALL ON FUNCTION private.portal_user_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.portal_distributor_ids(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.portal_clinic_ids(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.portal_scope_clinic_ids(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.portal_scope_region_ids(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.has_portal_role(uuid, public.portal_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_portal_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.portal_user_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.portal_distributor_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.portal_clinic_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.portal_scope_clinic_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.portal_scope_region_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_portal_role(uuid, public.portal_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_portal_user(uuid) TO authenticated, service_role;

-- ============================================================
-- M7: Provider accounts, private credentials, event dedupe
-- ============================================================
CREATE TABLE public.provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  surgeon_id uuid REFERENCES public.surgeons(id) ON DELETE SET NULL,
  provider public.payment_provider NOT NULL,
  country public.intl_country NOT NULL,
  currency char(3) NOT NULL,
  external_merchant_id text,
  status public.provider_account_status NOT NULL DEFAULT 'pending',
  connection_method public.provider_connection_method NOT NULL DEFAULT 'oauth',
  environment text NOT NULL DEFAULT 'sandbox',
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarding_status text,
  is_active boolean NOT NULL DEFAULT true,
  last_verified_at timestamptz,
  connected_by uuid,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_provider_accounts_clinic_provider
  ON public.provider_accounts (clinic_id, provider) WHERE surgeon_id IS NULL;
CREATE UNIQUE INDEX idx_provider_accounts_clinic_surgeon_provider
  ON public.provider_accounts (clinic_id, provider, surgeon_id) WHERE surgeon_id IS NOT NULL;
CREATE INDEX idx_provider_accounts_status ON public.provider_accounts (status) WHERE is_active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_accounts TO authenticated;
GRANT ALL ON public.provider_accounts TO service_role;
ALTER TABLE public.provider_accounts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_provider_accounts_updated_at BEFORE UPDATE ON public.provider_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE private.provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id uuid NOT NULL REFERENCES public.provider_accounts(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  public_key text,
  expires_at timestamptz,
  scope text,
  environment text NOT NULL DEFAULT 'sandbox',
  encrypted boolean NOT NULL DEFAULT false,
  rotated_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_credentials_account_unique UNIQUE (provider_account_id)
);
REVOKE ALL ON private.provider_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.provider_credentials TO service_role;
ALTER TABLE private.provider_credentials ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.processed_provider_events (
  provider public.payment_provider NOT NULL,
  external_event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  processing_status text NOT NULL DEFAULT 'received',
  error text,
  PRIMARY KEY (provider, external_event_id)
);
GRANT SELECT ON public.processed_provider_events TO authenticated;
GRANT ALL ON public.processed_provider_events TO service_role;
ALTER TABLE public.processed_provider_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read provider events" ON public.processed_provider_events
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
CREATE POLICY "Deny provider event writes" ON public.processed_provider_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================
-- M8: International policies and country settings
-- ============================================================
CREATE TABLE public.international_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country public.intl_country NOT NULL,
  language text NOT NULL DEFAULT 'es',
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE CASCADE,
  provider public.payment_provider,
  version text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  terms_text text NOT NULL,
  terms_url text,
  privacy_url text,
  content_sha256 text NOT NULL,
  cancellation_policy text,
  no_show_policy text,
  refund_exceptions text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_intl_policies_version
  ON public.international_policies (country, language, COALESCE(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
CREATE INDEX idx_intl_policies_active ON public.international_policies (country, language) WHERE is_active;
GRANT SELECT ON public.international_policies TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.international_policies TO authenticated;
GRANT ALL ON public.international_policies TO service_role;
ALTER TABLE public.international_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active intl policies" ON public.international_policies
  FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY "Admins manage intl policies" ON public.international_policies
  FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE TRIGGER update_intl_policies_updated_at BEFORE UPDATE ON public.international_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.international_country_settings (
  country public.intl_country PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT false,
  default_currency char(3) NOT NULL,
  default_language text NOT NULL DEFAULT 'es',
  allowed_providers public.payment_provider[] NOT NULL DEFAULT '{}',
  allow_patient_provider_choice boolean NOT NULL DEFAULT false,
  min_fee_minor integer NOT NULL DEFAULT 0,
  max_fee_minor integer,
  sla_first_contact_hours integer NOT NULL DEFAULT 24,
  link_expiry_hours integer NOT NULL DEFAULT 168,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.international_country_settings TO authenticated;
GRANT ALL ON public.international_country_settings TO service_role;
ALTER TABLE public.international_country_settings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_intl_country_settings_updated_at BEFORE UPDATE ON public.international_country_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.international_country_settings (country, default_currency, min_fee_minor) VALUES
  ('MX', 'MXN', 0), ('CO', 'COP', 0), ('CL', 'CLP', 0);

-- ============================================================
-- M9: Consultation patients, consultations, events, tasks
-- ============================================================
CREATE TABLE public.consultation_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text,
  phone text,
  country public.intl_country NOT NULL,
  preferred_language text NOT NULL DEFAULT 'es',
  notes text,
  zoho_record_id text,
  created_by_admin_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_consultation_patients_email_country
  ON public.consultation_patients (lower(email), country) WHERE email IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultation_patients TO authenticated;
GRANT ALL ON public.consultation_patients TO service_role;
ALTER TABLE public.consultation_patients ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_consultation_patients_updated_at BEFORE UPDATE ON public.consultation_patients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  token_last4 text NOT NULL,
  expires_at timestamptz NOT NULL,

  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE RESTRICT,
  surgeon_id uuid REFERENCES public.surgeons(id) ON DELETE SET NULL,
  region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL,
  distributor_id uuid REFERENCES public.distributors(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL REFERENCES public.consultation_patients(id) ON DELETE RESTRICT,

  created_by_admin_user_id uuid,
  agent_email text,
  agent_zoho_id text,

  amount_minor integer NOT NULL,
  currency char(3) NOT NULL,
  country public.intl_country NOT NULL,
  provider public.payment_provider NOT NULL,
  provider_account_id uuid REFERENCES public.provider_accounts(id) ON DELETE RESTRICT,
  recipient_external_merchant_id text,

  payment_status public.intl_payment_status NOT NULL DEFAULT 'draft',
  consultation_status public.intl_consultation_status NOT NULL DEFAULT 'draft',
  surgery_status public.intl_surgery_status NOT NULL DEFAULT 'none',

  provider_payment_id text,
  provider_order_id text,
  provider_checkout_url text,
  sent_at timestamptz,
  opened_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  expired_at timestamptz,
  refunded_at timestamptz,
  disputed_at timestamptz,

  first_contact_at timestamptz,
  scheduled_at timestamptz,
  rescheduled_count integer NOT NULL DEFAULT 0,
  consulted_at timestamptz,
  no_show_at timestamptz,
  closed_at timestamptz,
  outcome_notes text,

  surgery_recommended_at timestamptz,
  surgery_scheduled_at timestamptz,
  surgery_completed_at timestamptz,

  policy_id uuid REFERENCES public.international_policies(id) ON DELETE SET NULL,
  terms_version text,
  terms_sha256 text,
  terms_accepted_at timestamptz,
  terms_accept_ip text,
  terms_accept_user_agent text,
  signature_data text,

  zoho_module text,
  zoho_record_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultations_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT consultations_amount_positive CHECK (amount_minor >= 0)
);
CREATE INDEX idx_consultations_clinic_payment ON public.consultations (clinic_id, payment_status);
CREATE INDEX idx_consultations_distributor_created ON public.consultations (distributor_id, created_at DESC);
CREATE INDEX idx_consultations_status ON public.consultations (payment_status, consultation_status);
CREATE INDEX idx_consultations_provider_payment ON public.consultations (provider, provider_payment_id);
CREATE INDEX idx_consultations_patient ON public.consultations (patient_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultations TO authenticated;
GRANT ALL ON public.consultations TO service_role;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_consultations_updated_at BEFORE UPDATE ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Immutability of money-routing fields once the link has left draft/link_created
CREATE OR REPLACE FUNCTION public.enforce_consultation_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.payment_status NOT IN ('draft', 'link_created') THEN
    IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
       OR NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.provider_account_id IS DISTINCT FROM OLD.provider_account_id
       OR NEW.recipient_external_merchant_id IS DISTINCT FROM OLD.recipient_external_merchant_id
       OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
       OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'Consultation payment terms are immutable once the payment link has been sent';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_consultation_immutability_trigger
  BEFORE UPDATE ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_consultation_immutability();

CREATE TABLE public.consultation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_data jsonb,
  actor_type text NOT NULL DEFAULT 'system',
  actor_id uuid,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_consultation_events_consultation ON public.consultation_events (consultation_id, created_at DESC);
GRANT SELECT ON public.consultation_events TO authenticated;
GRANT ALL ON public.consultation_events TO service_role;
ALTER TABLE public.consultation_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.consultation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_consultation_tasks_open ON public.consultation_tasks (clinic_id, due_at) WHERE completed_at IS NULL;
CREATE INDEX idx_consultation_tasks_consultation ON public.consultation_tasks (consultation_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultation_tasks TO authenticated;
GRANT ALL ON public.consultation_tasks TO service_role;
ALTER TABLE public.consultation_tasks ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_consultation_tasks_updated_at BEFORE UPDATE ON public.consultation_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- M10: Integration audit log and Zoho outbox
-- ============================================================
CREATE TABLE public.integration_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration text NOT NULL,
  direction text NOT NULL,
  entity_type text,
  entity_id text,
  request_summary jsonb,
  response_status integer,
  error text,
  attempt integer NOT NULL DEFAULT 1,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_integration_audit_created ON public.integration_audit_logs (integration, created_at DESC);
GRANT SELECT ON public.integration_audit_logs TO authenticated;
GRANT ALL ON public.integration_audit_logs TO service_role;
ALTER TABLE public.integration_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read integration audit" ON public.integration_audit_logs
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
CREATE POLICY "Deny integration audit writes" ON public.integration_audit_logs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE public.intl_zoho_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid REFERENCES public.consultations(id) ON DELETE CASCADE,
  operation text NOT NULL,
  payload jsonb NOT NULL,
  status public.intl_outbox_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_intl_zoho_outbox_pending ON public.intl_zoho_outbox (status, next_attempt_at);
GRANT SELECT ON public.intl_zoho_outbox TO authenticated;
GRANT ALL ON public.intl_zoho_outbox TO service_role;
ALTER TABLE public.intl_zoho_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read zoho outbox" ON public.intl_zoho_outbox
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
CREATE POLICY "Deny zoho outbox writes" ON public.intl_zoho_outbox
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER update_intl_zoho_outbox_updated_at BEFORE UPDATE ON public.intl_zoho_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- M11: RLS policies for partner, portal and consultation tables
-- ============================================================

-- regions
CREATE POLICY "Admins manage regions" ON public.regions
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads in-scope regions" ON public.regions
  FOR SELECT TO authenticated USING (id IN (SELECT private.portal_scope_region_ids(auth.uid())));

-- distributors
CREATE POLICY "Admins manage distributors" ON public.distributors
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads own distributor" ON public.distributors
  FOR SELECT TO authenticated USING (id IN (SELECT private.portal_distributor_ids(auth.uid())));

-- distributor_regions
CREATE POLICY "Admins manage distributor regions" ON public.distributor_regions
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads own distributor regions" ON public.distributor_regions
  FOR SELECT TO authenticated USING (distributor_id IN (SELECT private.portal_distributor_ids(auth.uid())));

-- clinics
CREATE POLICY "Admins manage clinics" ON public.clinics
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads in-scope clinics" ON public.clinics
  FOR SELECT TO authenticated USING (id IN (SELECT private.portal_scope_clinic_ids(auth.uid())));

-- clinic_distributors
CREATE POLICY "Admins manage clinic distributors" ON public.clinic_distributors
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads own clinic distributors" ON public.clinic_distributors
  FOR SELECT TO authenticated USING (
    distributor_id IN (SELECT private.portal_distributor_ids(auth.uid()))
    OR clinic_id IN (SELECT private.portal_clinic_ids(auth.uid()))
  );

-- clinic_surgeons
CREATE POLICY "Admins manage clinic surgeons" ON public.clinic_surgeons
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads in-scope clinic surgeons" ON public.clinic_surgeons
  FOR SELECT TO authenticated USING (clinic_id IN (SELECT private.portal_scope_clinic_ids(auth.uid())));

-- portal_users
CREATE POLICY "Admins manage portal users" ON public.portal_users
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal users read themselves" ON public.portal_users
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Portal users read org peers" ON public.portal_users
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.portal_memberships pm
      WHERE pm.portal_user_id = portal_users.id
        AND pm.is_active AND pm.revoked_at IS NULL
        AND (
          pm.clinic_id IN (SELECT private.portal_clinic_ids(auth.uid()))
          OR pm.distributor_id IN (SELECT private.portal_distributor_ids(auth.uid()))
        )
    )
  );
CREATE POLICY "Portal users accept own invite" ON public.portal_users
  FOR UPDATE TO authenticated
  USING (user_id IS NULL AND accepted_at IS NULL AND lower(email) = lower(private.auth_user_email()))
  WITH CHECK (lower(email) = lower(private.auth_user_email()));

-- portal_memberships (no self-service writes)
CREATE POLICY "Admins manage portal memberships" ON public.portal_memberships
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads own memberships" ON public.portal_memberships
  FOR SELECT TO authenticated USING (
    portal_user_id = private.portal_user_id(auth.uid())
    OR clinic_id IN (SELECT private.portal_clinic_ids(auth.uid()))
    OR distributor_id IN (SELECT private.portal_distributor_ids(auth.uid()))
  );

-- provider_accounts (never exposes credentials)
CREATE POLICY "Admins manage provider accounts" ON public.provider_accounts
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads in-scope provider accounts" ON public.provider_accounts
  FOR SELECT TO authenticated USING (clinic_id IN (SELECT private.portal_scope_clinic_ids(auth.uid())));

-- international_country_settings
CREATE POLICY "Admins manage country settings" ON public.international_country_settings
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads country settings" ON public.international_country_settings
  FOR SELECT TO authenticated USING (private.is_portal_user(auth.uid()));

-- consultation_patients
CREATE POLICY "Admins manage consultation patients" ON public.consultation_patients
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads in-scope consultation patients" ON public.consultation_patients
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.consultations c
      WHERE c.patient_id = consultation_patients.id
        AND c.clinic_id IN (SELECT private.portal_scope_clinic_ids(auth.uid()))
    )
  );

-- consultations: portal read-only, all writes admin or service role
CREATE POLICY "Admins read consultations" ON public.consultations
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
CREATE POLICY "Admins insert consultations" ON public.consultations
  FOR INSERT TO authenticated WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Admins update consultations" ON public.consultations
  FOR UPDATE TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Admins delete consultations" ON public.consultations
  FOR DELETE TO authenticated USING (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads in-scope consultations" ON public.consultations
  FOR SELECT TO authenticated USING (clinic_id IN (SELECT private.portal_scope_clinic_ids(auth.uid())));

-- consultation_events: append-only, read scoped
CREATE POLICY "Admins read consultation events" ON public.consultation_events
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads in-scope consultation events" ON public.consultation_events
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.consultations c
      WHERE c.id = consultation_events.consultation_id
        AND c.clinic_id IN (SELECT private.portal_scope_clinic_ids(auth.uid()))
    )
  );
CREATE POLICY "Deny consultation event insert" ON public.consultation_events
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Deny consultation event update" ON public.consultation_events
  FOR UPDATE TO authenticated USING (false);
CREATE POLICY "Deny consultation event delete" ON public.consultation_events
  FOR DELETE TO authenticated USING (false);

-- consultation_tasks
CREATE POLICY "Admins manage consultation tasks" ON public.consultation_tasks
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads in-scope consultation tasks" ON public.consultation_tasks
  FOR SELECT TO authenticated USING (clinic_id IN (SELECT private.portal_scope_clinic_ids(auth.uid())));