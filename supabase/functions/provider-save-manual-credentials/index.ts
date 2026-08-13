// Save Mercado Pago (or other provider) credentials entered manually, as a
// fallback when OAuth is not used. Callable by a Himplant admin or by the
// surgeon_admin who owns the surgeon. Values are write-only: they are
// encrypted immediately and never redisplayed.
import { requireProviderEnabled } from "../_shared/flags.ts";
import {
  accountMasks,
  actorMayManageSurgeon,
  corsHeaders,
  encryptionKeyErrorResponse,
  getPlatformConfig,
  json,
  loadAccountCredentials,
  logProviderAudit,
  normalizeEnvironment,
  resolveProviderActor,
  saveAccountCredentials,
} from "../_shared/provider-config.ts";

const SECRET_FIELDS = [
  "access_token",
  "refresh_token",
  "public_key",
  "client_id",
  "client_secret",
  "webhook_secret",
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await resolveProviderActor(req);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const db = actor.supabaseAdmin;

  try {
    const body = await req.json().catch(() => ({}));
    const surgeonId = String(body.surgeonId ?? "");
    const provider = String(body.provider ?? "mercado_pago");
    if (provider !== "mercado_pago") return json({ error: "Unsupported provider" }, 400);
    const providerBlock = await requireProviderEnabled(provider);
    if (providerBlock) return providerBlock;
    if (!surgeonId) return json({ error: "surgeonId is required" }, 400);
    if (!actorMayManageSurgeon(actor, surgeonId)) {
      return json({ error: "Surgeon is outside your scope" }, 403);
    }

    const environment = normalizeEnvironment(body.environment);
    const credentials: Record<string, string> = {};
    for (const key of SECRET_FIELDS) {
      const value = body.credentials?.[key];
      if (typeof value === "string" && value.trim()) credentials[key] = value.trim();
    }
    if (!credentials.access_token) return json({ error: "Access Token is required" }, 400);

    const { data: surgeon } = await db
      .from("surgeons")
      .select("id, country, currency")
      .eq("id", surgeonId)
      .maybeSingle();
    if (!surgeon) return json({ error: "Surgeon not found" }, 404);

    const country = String(body.country ?? surgeon.country ?? "").toUpperCase();
    if (!["MX", "CO", "CL"].includes(country)) {
      return json({ error: "Surgeon country must be MX, CO or CL" }, 400);
    }
    const currency = String(body.currency ?? surgeon.currency ?? "").toUpperCase() ||
      ({ MX: "MXN", CO: "COP", CL: "CLP" } as Record<string, string>)[country];

    const platformConfig = await getPlatformConfig(db, provider, environment);

    const { data: existing } = await db
      .from("provider_accounts")
      .select("id")
      .eq("surgeon_id", surgeonId)
      .eq("provider", provider)
      .eq("environment", environment)
      .maybeSingle();

    let accountId = existing?.id as string | undefined;
    const metadata = {
      surgeon_id: surgeonId,
      provider,
      country,
      currency,
      environment,
      connection_method: "admin_managed",
      status: "pending",
      external_merchant_id: body.merchantId ? String(body.merchantId) : null,
      platform_config_id: platformConfig?.id ?? null,
      connection_error: null,
      onboarding_status: "credentials_saved",
      live_mode: environment === "live",
      connected_by: actor.userId,
      connected_at: new Date().toISOString(),
      disconnected_at: null,
    };

    if (accountId) {
      const { error } = await db.from("provider_accounts").update(metadata).eq("id", accountId);
      if (error) return json({ error: error.message }, 400);
    } else {
      const { data, error } = await db
        .from("provider_accounts")
        .insert({ ...metadata, is_active: false })
        .select("id")
        .single();
      if (error) return json({ error: error.message }, 400);
      accountId = data.id as string;
    }

    // Preserve any credential the caller did not resend.
    const prior = (await loadAccountCredentials(db, accountId!))?.credentials ?? {};
    const merged = { ...prior, ...credentials };

    await saveAccountCredentials(db, accountId!, merged, {
      expiresAt: null,
      scope: null,
      environment,
    });

    const masks = accountMasks(merged);
    await db.from("provider_accounts").update({ credential_masks: masks }).eq("id", accountId!);

    await logProviderAudit(db, {
      provider,
      action: "manual_credentials",
      entityType: "provider_account",
      entityId: accountId!,
      actorId: actor.userId,
      summary: { surgeon_id: surgeonId, environment, fields: Object.keys(credentials) },
      responseStatus: 200,
    });

    return json({
      accountId,
      status: "pending",
      credential_masks: masks,
      message: "Credentials stored. Run Test connection to verify.",
    });
  } catch (err) {
    const keyErr = encryptionKeyErrorResponse(err);
    if (keyErr) return keyErr;
    console.error("provider-save-manual-credentials failed", (err as Error).message);
    return json({ error: (err as Error).message }, 500);
  }
});
