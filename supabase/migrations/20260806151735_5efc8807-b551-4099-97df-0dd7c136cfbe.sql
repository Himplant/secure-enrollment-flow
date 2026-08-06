
-- ============================================================
-- 1. Platform-level provider configuration (metadata only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.provider_platform_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider payment_provider NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','live')),
  country intl_country,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','configured','verified','error','disabled')),
  is_complete boolean NOT NULL DEFAULT false,
  missing_fields text[] NOT NULL DEFAULT '{}',
  callback_url text,
  webhook_url text,
  return_url text,
  credential_masks jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at timestamptz,
  last_test_error text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_platform_configs_unique_country
  ON public.provider_platform_configs (provider, environment, country)
  WHERE country IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS provider_platform_configs_unique_global
  ON public.provider_platform_configs (provider, environment)
  WHERE country IS NULL;

GRANT SELECT ON public.provider_platform_configs TO authenticated;
GRANT ALL ON public.provider_platform_configs TO service_role;
ALTER TABLE public.provider_platform_configs ENABLE ROW LEVEL SECURITY;

-- Read-only for Himplant admins; every write goes through edge functions
-- running as the service role.
CREATE POLICY "Admins read provider platform configs"
  ON public.provider_platform_configs FOR SELECT
  TO authenticated
  USING (private.is_admin(auth.uid()));

CREATE TRIGGER update_provider_platform_configs_updated_at
  BEFORE UPDATE ON public.provider_platform_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. Encrypted platform credentials (service role only)
-- ============================================================
CREATE TABLE IF NOT EXISTS private.provider_platform_credentials (
  platform_config_id uuid PRIMARY KEY
    REFERENCES public.provider_platform_configs(id) ON DELETE CASCADE,
  encrypted_blob text NOT NULL,
  iv text NOT NULL,
  encryption_version integer NOT NULL DEFAULT 1,
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.provider_platform_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.provider_platform_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.provider_platform_credentials TO service_role;

-- ============================================================
-- 3. One-time OAuth transaction states (service role only)
-- ============================================================
CREATE TABLE IF NOT EXISTS private.provider_oauth_states (
  state text PRIMARY KEY,
  provider payment_provider NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox',
  surgeon_id uuid REFERENCES public.surgeons(id) ON DELETE CASCADE,
  platform_config_id uuid REFERENCES public.provider_platform_configs(id) ON DELETE CASCADE,
  code_verifier text,
  redirect_after text,
  created_by uuid,
  created_by_email text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.provider_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.provider_oauth_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.provider_oauth_states TO service_role;

-- ============================================================
-- 4. provider_accounts: additive safe metadata
-- ============================================================
ALTER TABLE public.provider_accounts
  ADD COLUMN IF NOT EXISTS platform_config_id uuid REFERENCES public.provider_platform_configs(id),
  ADD COLUMN IF NOT EXISTS onboarding_url text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS scopes text,
  ADD COLUMN IF NOT EXISTS credential_masks jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS connection_error text,
  ADD COLUMN IF NOT EXISTS last_tested_at timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_status text,
  ADD COLUMN IF NOT EXISTS live_mode boolean NOT NULL DEFAULT false;

-- Surgeon-office admins may read their own account metadata (never secrets).
DROP POLICY IF EXISTS "Surgeon admins read own provider accounts" ON public.provider_accounts;
CREATE POLICY "Surgeon admins read own provider accounts"
  ON public.provider_accounts FOR SELECT
  TO authenticated
  USING (
    private.has_portal_role(auth.uid(), 'surgeon_admin')
    AND surgeon_id IN (SELECT private.portal_surgeon_ids(auth.uid()))
  );

-- ============================================================
-- 5. provider_credentials: encrypted-only storage going forward
-- ============================================================
ALTER TABLE private.provider_credentials
  ADD COLUMN IF NOT EXISTS encrypted_blob text,
  ADD COLUMN IF NOT EXISTS iv text,
  ADD COLUMN IF NOT EXISTS encryption_version integer NOT NULL DEFAULT 1;

-- ============================================================
-- 6. Service-definer accessors (service role only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.store_provider_platform_credentials(
  _config_id uuid, _blob text, _iv text, _version integer DEFAULT 1
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'private','public' AS $$
BEGIN
  INSERT INTO private.provider_platform_credentials (platform_config_id, encrypted_blob, iv, encryption_version, rotated_at)
  VALUES (_config_id, _blob, _iv, _version, now())
  ON CONFLICT (platform_config_id) DO UPDATE
    SET encrypted_blob = EXCLUDED.encrypted_blob,
        iv = EXCLUDED.iv,
        encryption_version = EXCLUDED.encryption_version,
        rotated_at = now(),
        updated_at = now();
END; $$;
REVOKE ALL ON FUNCTION public.store_provider_platform_credentials(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_provider_platform_credentials(uuid, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.read_provider_platform_credentials(_config_id uuid)
RETURNS TABLE(encrypted_blob text, iv text, encryption_version integer)
LANGUAGE sql SECURITY DEFINER SET search_path = 'private','public' AS $$
  SELECT c.encrypted_blob, c.iv, c.encryption_version
  FROM private.provider_platform_credentials c
  WHERE c.platform_config_id = _config_id;
$$;
REVOKE ALL ON FUNCTION public.read_provider_platform_credentials(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_provider_platform_credentials(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.store_provider_account_credentials(
  _account_id uuid, _blob text, _iv text, _expires_at timestamptz, _scope text, _environment text, _version integer DEFAULT 1
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'private','public' AS $$
DECLARE existing uuid;
BEGIN
  SELECT id INTO existing FROM private.provider_credentials WHERE provider_account_id = _account_id LIMIT 1;
  IF existing IS NULL THEN
    INSERT INTO private.provider_credentials
      (provider_account_id, encrypted_blob, iv, encryption_version, expires_at, scope, environment, encrypted, rotated_at)
    VALUES (_account_id, _blob, _iv, _version, _expires_at, _scope, _environment, true, now());
  ELSE
    UPDATE private.provider_credentials
      SET encrypted_blob = _blob, iv = _iv, encryption_version = _version,
          expires_at = _expires_at, scope = _scope, environment = _environment,
          encrypted = true, rotated_at = now(), updated_at = now(),
          access_token = NULL, refresh_token = NULL, public_key = NULL
      WHERE id = existing;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.store_provider_account_credentials(uuid, text, text, timestamptz, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_provider_account_credentials(uuid, text, text, timestamptz, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.read_provider_account_credentials(_account_id uuid)
RETURNS TABLE(encrypted_blob text, iv text, encryption_version integer, expires_at timestamptz, scope text, environment text)
LANGUAGE sql SECURITY DEFINER SET search_path = 'private','public' AS $$
  SELECT c.encrypted_blob, c.iv, c.encryption_version, c.expires_at, c.scope, c.environment
  FROM private.provider_credentials c
  WHERE c.provider_account_id = _account_id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.read_provider_account_credentials(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_provider_account_credentials(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.create_provider_oauth_state(
  _state text, _provider payment_provider, _environment text, _surgeon_id uuid,
  _platform_config_id uuid, _code_verifier text, _redirect_after text,
  _created_by uuid, _created_by_email text, _ttl_seconds integer DEFAULT 600
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'private','public' AS $$
BEGIN
  DELETE FROM private.provider_oauth_states WHERE expires_at < now() - interval '1 day';
  INSERT INTO private.provider_oauth_states
    (state, provider, environment, surgeon_id, platform_config_id, code_verifier, redirect_after, created_by, created_by_email, expires_at)
  VALUES (_state, _provider, _environment, _surgeon_id, _platform_config_id, _code_verifier, _redirect_after, _created_by, _created_by_email,
          now() + make_interval(secs => _ttl_seconds));
END; $$;
REVOKE ALL ON FUNCTION public.create_provider_oauth_state(text, payment_provider, text, uuid, uuid, text, text, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_provider_oauth_state(text, payment_provider, text, uuid, uuid, text, text, uuid, text, integer) TO service_role;

-- Atomically consume: a state can only ever be redeemed once.
CREATE OR REPLACE FUNCTION public.consume_provider_oauth_state(_state text)
RETURNS TABLE(provider payment_provider, environment text, surgeon_id uuid, platform_config_id uuid,
              code_verifier text, redirect_after text, created_by uuid, created_by_email text)
LANGUAGE sql SECURITY DEFINER SET search_path = 'private','public' AS $$
  UPDATE private.provider_oauth_states s
     SET consumed_at = now()
   WHERE s.state = _state
     AND s.consumed_at IS NULL
     AND s.expires_at > now()
  RETURNING s.provider, s.environment, s.surgeon_id, s.platform_config_id,
            s.code_verifier, s.redirect_after, s.created_by, s.created_by_email;
$$;
REVOKE ALL ON FUNCTION public.consume_provider_oauth_state(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_provider_oauth_state(text) TO service_role;

-- ============================================================
-- 7. Feature flags (all OFF)
-- ============================================================
INSERT INTO public.app_feature_flags (key, enabled, description, scope)
VALUES
  ('mercado_pago_enabled', false, 'Mercado Pago payments for international consultations', '{}'::jsonb),
  ('provider_setup_enabled', false, 'Provider platform configuration and connection UI', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;
