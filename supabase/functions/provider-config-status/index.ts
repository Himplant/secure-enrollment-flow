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
import { enabledProviders } from "../_shared/flags.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await resolveProviderActor(req);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const db = actor.supabaseAdmin;

  const body = await req.json().catch(() => ({}));
  const environment = normalizeEnvironment(body.environment);

  // Only providers whose runtime feature flag is ON are ever described here.
  // A disabled provider must not appear as a connectable option anywhere in
  // the UI, and the mutation endpoints reject it as well.
  const enabled = await enabledProviders();
  const visibleProviders = Object.keys(PLATFORM_FIELDS).filter((p) => enabled.includes(p));

  const platform: Record<string, unknown>[] = [];
  if (actor.kind === "admin") {
    const { data: configs } = await db
      .from("provider_platform_configs")
      .select(
        "id, provider, environment, country, status, is_complete, missing_fields, callback_url, webhook_url, return_url, credential_masks, capabilities, last_verified_at, last_test_error, updated_at",
      )
      .eq("environment", environment);

    for (const provider of visibleProviders) {
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
  } else {
    // Portal surgeons get NON-SECRET provider metadata only: which providers
    // exist and whether Himplant has finished platform setup. No credential
    // values, masks, URLs or config rows are exposed here.
    const { data: configs } = await db
      .from("provider_platform_configs")
      .select("provider, is_complete")
      .eq("environment", environment);

    for (const provider of visibleProviders) {
      const existing = (configs ?? []).find((c) => c.provider === provider) ?? null;
      platform.push({
        provider,
        environment,
        implemented: IMPLEMENTED_PROVIDERS.includes(provider as never),
        platformReady: !!existing?.is_complete,
        fields: [],
        callbackUrl: "",
        webhookUrl: "",
        returnUrl: "",
        config: null,
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

  // Surgeons the caller may connect an account FOR. Returned explicitly so a
  // portal surgeon with zero provider_accounts can still make a first
  // connection (the client must never derive this list itself).
  let surgeonQuery = db
    .from("surgeons")
    .select("id, name, country")
    .eq("is_international", true)
    .order("name");
  if (actor.surgeonIds !== null) {
    surgeonQuery = actor.surgeonIds.length
      ? surgeonQuery.in("id", actor.surgeonIds)
      : surgeonQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  const { data: scopedSurgeons } = await surgeonQuery;

  return json({
    actor: { kind: actor.kind, canManagePlatform: actor.kind === "admin" },
    environment,
    enabled_providers: visibleProviders,
    platform,
    surgeons: scopedSurgeons ?? [],

    accounts: accounts ?? [],
  });
});
