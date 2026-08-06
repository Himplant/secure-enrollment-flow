// Read-only provider setup status: platform configuration completeness and the
// surgeon connected-account metadata the UI renders. Masks only — this
// endpoint can never return a credential value.
import {
  corsHeaders,
  IMPLEMENTED_PROVIDERS,
  json,
  normalizeEnvironment,
  PLATFORM_FIELDS,
  providerCallbackUrl,
  providerReturnUrl,
  providerWebhookUrl,
  resolveProviderActor,
} from "../_shared/provider-config.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await resolveProviderActor(req);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const db = actor.supabaseAdmin;

  const body = await req.json().catch(() => ({}));
  const environment = normalizeEnvironment(body.environment);

  const platform: Record<string, unknown>[] = [];
  if (actor.kind === "admin") {
    const { data: configs } = await db
      .from("provider_platform_configs")
      .select(
        "id, provider, environment, country, status, is_complete, missing_fields, callback_url, webhook_url, return_url, credential_masks, capabilities, last_verified_at, last_test_error, updated_at",
      )
      .eq("environment", environment);

    for (const provider of Object.keys(PLATFORM_FIELDS)) {
      const existing = (configs ?? []).find((c) => c.provider === provider) ?? null;
      platform.push({
        provider,
        environment,
        implemented: IMPLEMENTED_PROVIDERS.includes(provider as never),
        fields: PLATFORM_FIELDS[provider].map(({ key, label, required, secret }) => ({
          key,
          label,
          required,
          secret,
        })),
        callbackUrl: existing?.callback_url ?? providerCallbackUrl(),
        webhookUrl: existing?.webhook_url ?? providerWebhookUrl(provider as never),
        returnUrl: existing?.return_url ?? providerReturnUrl(),
        config: existing,
      });
    }
  }

  let accountQuery = db
    .from("provider_accounts")
    .select(
      "id, surgeon_id, provider, country, currency, environment, connection_method, external_merchant_id, status, is_active, live_mode, scopes, token_expires_at, onboarding_status, onboarding_url, connection_error, last_verified_at, last_tested_at, webhook_status, credential_masks, updated_at, surgeons(name, country)",
    )
    .order("updated_at", { ascending: false });

  if (actor.surgeonIds !== null) {
    accountQuery = accountQuery.in("surgeon_id", actor.surgeonIds);
  }

  const { data: accounts, error } = await accountQuery;
  if (error) return json({ error: error.message }, 400);

  return json({
    actor: { kind: actor.kind, canManagePlatform: actor.kind === "admin" },
    environment,
    platform,
    accounts: accounts ?? [],
  });
});
