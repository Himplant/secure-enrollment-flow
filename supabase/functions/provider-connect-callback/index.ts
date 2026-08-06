// Public OAuth callback. No JWT: the request is authenticated by the one-time
// `state` created by provider-connect-start, which is atomically consumed here.
import {
  accountMasks,
  appBase,
  corsHeaders,
  getPlatformConfig,
  json,
  loadPlatformCredentials,
  logProviderAudit,
  normalizeEnvironment,
  providerCallbackUrl,
  saveAccountCredentials,
  serviceClient,
} from "../_shared/provider-config.ts";
import { mpExchangeCode, mpGetUserMe } from "../_shared/providers/mercado-pago.ts";

function redirect(to: string, params: Record<string, string>): Response {
  const url = new URL(to, appBase() || "https://example.invalid");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: url.toString() } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = serviceClient();
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const fallback = `${appBase()}/admin`;

  if (!state) return json({ error: "Missing state" }, 400);

  const { data: consumed, error: consumeErr } = await db.rpc("consume_provider_oauth_state", {
    _state: state,
  });
  const tx = Array.isArray(consumed) ? consumed[0] : consumed;
  if (consumeErr || !tx) {
    return redirect(fallback, { provider_connect: "error", reason: "invalid_or_expired_state" });
  }

  const redirectAfter = (tx.redirect_after as string) || fallback;

  if (!code) {
    return redirect(redirectAfter, { provider_connect: "error", reason: "missing_code" });
  }

  try {
    const provider = String(tx.provider);
    if (provider !== "mercado_pago") throw new Error("Unsupported provider");
    const environment = normalizeEnvironment(tx.environment);

    const config = (await getPlatformConfig(db, provider, environment)) ??
      (tx.platform_config_id ? { id: tx.platform_config_id as string, callback_url: null } as never : null);
    if (!config) throw new Error("Platform configuration missing");

    const platform = await loadPlatformCredentials(db, config.id);
    if (!platform?.client_id || !platform?.client_secret) {
      throw new Error("Platform credentials missing");
    }

    const token = await mpExchangeCode({
      clientId: platform.client_id,
      clientSecret: platform.client_secret,
      code,
      redirectUri: config.callback_url ?? providerCallbackUrl(),
      codeVerifier: (tx.code_verifier as string | null) ?? null,
    });

    const merchantId = token.user_id != null ? String(token.user_id) : null;
    const surgeonId = tx.surgeon_id as string;

    const { data: surgeon } = await db
      .from("surgeons")
      .select("id, country, currency")
      .eq("id", surgeonId)
      .maybeSingle();
    const country = String(surgeon?.country ?? "").toUpperCase();
    if (!["MX", "CO", "CL"].includes(country)) throw new Error("Surgeon country is not supported");
    const currency = String(surgeon?.currency ?? "").toUpperCase() ||
      ({ MX: "MXN", CO: "COP", CL: "CLP" } as Record<string, string>)[country];

    // Identity verification: never mark connected on a token alone.
    const me = await mpGetUserMe(token.access_token);
    const meId = me.id != null ? String(me.id) : null;
    const verifiedMerchantId = merchantId ?? meId;
    if (merchantId && meId && merchantId !== meId) {
      throw new Error("Mercado Pago identity mismatch");
    }

    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null;

    const { data: existing } = await db
      .from("provider_accounts")
      .select("id")
      .eq("surgeon_id", surgeonId)
      .eq("provider", provider)
      .eq("environment", environment)
      .maybeSingle();

    const metadata = {
      surgeon_id: surgeonId,
      provider,
      country,
      currency,
      environment,
      connection_method: "oauth",
      status: "connected",
      external_merchant_id: verifiedMerchantId,
      platform_config_id: config.id,
      scopes: token.scope ?? null,
      token_expires_at: expiresAt,
      onboarding_status: "connected",
      connection_error: null,
      live_mode: !!me.live_mode || environment === "live",
      last_verified_at: new Date().toISOString(),
      last_tested_at: new Date().toISOString(),
      connected_by: (tx.created_by as string | null) ?? null,
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      capabilities: { checkout_pro: true, site_id: me.site_id ?? null },
    };

    let accountId = existing?.id as string | undefined;
    if (accountId) {
      await db.from("provider_accounts").update(metadata).eq("id", accountId);
    } else {
      const { data, error } = await db
        .from("provider_accounts")
        .insert({ ...metadata, is_active: false })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      accountId = data.id as string;
    }

    const credentials = {
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? null,
      public_key: token.public_key ?? null,
    };
    await saveAccountCredentials(db, accountId!, credentials, {
      expiresAt,
      scope: token.scope ?? null,
      environment,
    });
    await db
      .from("provider_accounts")
      .update({ credential_masks: accountMasks(credentials) })
      .eq("id", accountId!);

    await logProviderAudit(db, {
      provider,
      action: "connect",
      entityType: "provider_account",
      entityId: accountId!,
      actorId: (tx.created_by as string | null) ?? null,
      summary: { surgeon_id: surgeonId, environment, merchant_id: verifiedMerchantId },
      responseStatus: 200,
    });

    return redirect(redirectAfter, { provider_connect: "success", provider });
  } catch (err) {
    const message = (err as Error).message;
    console.error("provider-connect-callback failed:", message);
    await logProviderAudit(db, {
      provider: String(tx.provider ?? "mercado_pago"),
      action: "connect",
      entityType: "provider_account",
      entityId: null,
      actorId: (tx.created_by as string | null) ?? null,
      summary: { surgeon_id: tx.surgeon_id },
      responseStatus: 500,
      error: message,
    });
    return redirect(redirectAfter, { provider_connect: "error", reason: "exchange_failed" });
  }
});
