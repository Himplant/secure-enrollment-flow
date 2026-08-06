
-- ============ 1. POLICY SYSTEM =====================================
ALTER TABLE public.international_policies
  ADD COLUMN IF NOT EXISTS is_country_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

UPDATE public.international_policies SET is_country_default = true WHERE surgeon_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS intl_policy_country_default_prov_uniq
  ON public.international_policies (country, language, provider)
  WHERE is_active AND surgeon_id IS NULL AND provider IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS intl_policy_country_default_uniq
  ON public.international_policies (country, language)
  WHERE is_active AND surgeon_id IS NULL AND provider IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS intl_policy_surgeon_prov_uniq
  ON public.international_policies (surgeon_id, country, language, provider)
  WHERE is_active AND surgeon_id IS NOT NULL AND provider IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS intl_policy_surgeon_uniq
  ON public.international_policies (surgeon_id, country, language)
  WHERE is_active AND surgeon_id IS NOT NULL AND provider IS NULL;

CREATE OR REPLACE FUNCTION public.intl_policy_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT EXISTS(SELECT 1 FROM public.consultations WHERE policy_id = OLD.id)
        OR EXISTS(SELECT 1 FROM public.consultation_policy_snapshots WHERE policy_id = OLD.id)
      INTO used;
    IF used THEN
      RAISE EXCEPTION 'Policy % is used by a consultation and cannot be deleted. Retire it instead.', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.consultations WHERE policy_id = NEW.id)
      OR EXISTS(SELECT 1 FROM public.consultation_policy_snapshots WHERE policy_id = NEW.id)
    INTO used;

  IF used AND (
      NEW.terms_text IS DISTINCT FROM OLD.terms_text
   OR NEW.version IS DISTINCT FROM OLD.version
   OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
   OR NEW.cancellation_policy IS DISTINCT FROM OLD.cancellation_policy
   OR NEW.no_show_policy IS DISTINCT FROM OLD.no_show_policy
   OR NEW.refund_exceptions IS DISTINCT FROM OLD.refund_exceptions
   OR NEW.privacy_url IS DISTINCT FROM OLD.privacy_url
   OR NEW.terms_url IS DISTINCT FROM OLD.terms_url
   OR NEW.country IS DISTINCT FROM OLD.country
   OR NEW.language IS DISTINCT FROM OLD.language
   OR NEW.provider IS DISTINCT FROM OLD.provider
   OR NEW.surgeon_id IS DISTINCT FROM OLD.surgeon_id
  ) THEN
    RAISE EXCEPTION 'Published policy % is immutable. Create a new version instead.', NEW.id;
  END IF;

  IF OLD.is_active AND NOT NEW.is_active AND NEW.retired_at IS NULL THEN
    NEW.retired_at := now();
  END IF;

  RETURN NEW;
END;
$$;

-- ============ 2. POLICY SNAPSHOTS ==================================
CREATE TABLE IF NOT EXISTS public.consultation_policy_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultations(id),
  policy_id uuid REFERENCES public.international_policies(id),
  resolution_rule text NOT NULL,
  country intl_country NOT NULL,
  language text NOT NULL,
  provider payment_provider NOT NULL,
  surgeon_id uuid NOT NULL REFERENCES public.surgeons(id),
  amount_minor integer NOT NULL,
  currency char(3) NOT NULL,
  policy_version text NOT NULL,
  content_sha256 text NOT NULL,
  terms_text text NOT NULL,
  terms_url text,
  privacy_url text,
  privacy_text text,
  cancellation_policy text,
  no_show_policy text,
  refund_exceptions text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.consultation_policy_snapshots TO authenticated;
GRANT ALL ON public.consultation_policy_snapshots TO service_role;
ALTER TABLE public.consultation_policy_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read policy snapshots" ON public.consultation_policy_snapshots
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads in-scope policy snapshots" ON public.consultation_policy_snapshots
  FOR SELECT TO authenticated
  USING (surgeon_id IN (SELECT private.portal_scope_surgeon_ids(auth.uid())));
CREATE POLICY "Deny snapshot writes" ON public.consultation_policy_snapshots
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.snapshot_is_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Consultation policy snapshots are immutable';
END;
$$;

DROP TRIGGER IF EXISTS snapshot_immutable ON public.consultation_policy_snapshots;
CREATE TRIGGER snapshot_immutable BEFORE UPDATE OR DELETE ON public.consultation_policy_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_is_immutable();

DROP TRIGGER IF EXISTS intl_policy_guard_trg ON public.international_policies;
CREATE TRIGGER intl_policy_guard_trg BEFORE UPDATE OR DELETE ON public.international_policies
  FOR EACH ROW EXECUTE FUNCTION public.intl_policy_guard();

-- ============ 3. PRIVATE LINK SECRETS ==============================
CREATE TABLE IF NOT EXISTS private.consultation_link_secrets (
  consultation_id uuid PRIMARY KEY,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  token_last4 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.consultation_link_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.consultation_link_secrets TO service_role;

CREATE OR REPLACE FUNCTION public.store_consultation_link_secret(
  _consultation_id uuid, _ciphertext text, _iv text, _last4 text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
BEGIN
  INSERT INTO private.consultation_link_secrets (consultation_id, ciphertext, iv, token_last4)
  VALUES (_consultation_id, _ciphertext, _iv, _last4)
  ON CONFLICT (consultation_id) DO UPDATE
    SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv,
        token_last4 = EXCLUDED.token_last4, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.read_consultation_link_secret(_consultation_id uuid)
RETURNS TABLE (ciphertext text, iv text, token_last4 text)
LANGUAGE sql SECURITY DEFINER SET search_path = private, public AS $$
  SELECT s.ciphertext, s.iv, s.token_last4
  FROM private.consultation_link_secrets s
  WHERE s.consultation_id = _consultation_id;
$$;

REVOKE ALL ON FUNCTION public.store_consultation_link_secret(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_consultation_link_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_consultation_link_secret(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_consultation_link_secret(uuid) TO service_role;

-- ============ 4. MESSAGES ==========================================
CREATE TABLE IF NOT EXISTS public.consultation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultations(id),
  message_type text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  recipient text NOT NULL,
  language text NOT NULL DEFAULT 'es',
  template_version text NOT NULL DEFAULT 'v1',
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 1,
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  bounced_at timestamptz,
  actor_type text NOT NULL DEFAULT 'system',
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consultation_messages_consultation_idx ON public.consultation_messages (consultation_id, created_at DESC);
GRANT SELECT ON public.consultation_messages TO authenticated;
GRANT ALL ON public.consultation_messages TO service_role;
ALTER TABLE public.consultation_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read consultation messages" ON public.consultation_messages
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads in-scope messages" ON public.consultation_messages
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.consultations c
    WHERE c.id = consultation_messages.consultation_id
      AND c.surgeon_id IN (SELECT private.portal_scope_surgeon_ids(auth.uid()))));
CREATE POLICY "Deny message writes" ON public.consultation_messages
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER update_consultation_messages_updated_at BEFORE UPDATE ON public.consultation_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 5. PAYMENT ATTEMPTS ==================================
CREATE TABLE IF NOT EXISTS public.consultation_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultations(id),
  provider payment_provider NOT NULL,
  provider_order_id text,
  provider_payment_id text,
  checkout_url text,
  amount_minor integer NOT NULL,
  currency char(3) NOT NULL,
  status intl_payment_status NOT NULL DEFAULT 'link_created',
  failure_reason text,
  raw_provider_payload jsonb,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_attempts_consultation_idx ON public.consultation_payment_attempts (consultation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_attempts_lookup_idx ON public.consultation_payment_attempts (provider, provider_payment_id);
GRANT SELECT ON public.consultation_payment_attempts TO authenticated;
GRANT ALL ON public.consultation_payment_attempts TO service_role;
ALTER TABLE public.consultation_payment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read payment attempts" ON public.consultation_payment_attempts
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
CREATE POLICY "Portal reads in-scope payment attempts" ON public.consultation_payment_attempts
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.consultations c
    WHERE c.id = consultation_payment_attempts.consultation_id
      AND c.surgeon_id IN (SELECT private.portal_scope_surgeon_ids(auth.uid()))));
CREATE POLICY "Deny payment attempt writes" ON public.consultation_payment_attempts
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER update_payment_attempts_updated_at BEFORE UPDATE ON public.consultation_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 6. REMINDER CONFIG / COUNTERS ========================
ALTER TABLE public.international_country_settings
  ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_hours_after_create integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS reminder_hours_before_expiry integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS max_reminders integer NOT NULL DEFAULT 2;

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS policy_snapshot_id uuid REFERENCES public.consultation_policy_snapshots(id),
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'es';

CREATE UNIQUE INDEX IF NOT EXISTS consultations_open_zoho_record_uniq
  ON public.consultations (zoho_module, zoho_record_id)
  WHERE zoho_record_id IS NOT NULL
    AND payment_status IN ('draft','link_created','link_sent','link_opened');

-- ============ 7. WEBHOOK RETRY BOOKKEEPING =========================
ALTER TABLE public.processed_provider_events
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS consultation_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ============ 8. DISTRIBUTOR SCOPE =================================
ALTER TABLE public.distributors
  ADD COLUMN IF NOT EXISTS countries text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.distributor_surgeons
  ADD COLUMN IF NOT EXISTS is_override boolean NOT NULL DEFAULT true;
