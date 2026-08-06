// Super-admin: save/update the Himplant platform application credentials for a
// payment provider (currently Mercado Pago). Credentials are encrypted at rest
// and never returned. Responses contain masks and completeness only.
import {
  corsHeaders,
  getPlatformConfig,
  json,
  loadPlatformCredentials,
  logProviderAudit,
  normalizeEnvironment,
  PLATFORM_FIELDS,
  providerCallbackUrl,
  providerReturnUrl,
  providerWebhookUrl,
  resolveProviderActor,
  savePlatformCredentials,
  type SupportedProvider,
  validatePlatformCompleteness,
  encryptionKeyErrorResponse,
} from "../_shared/provider-config.ts";
import { buildCredentialMasks } from "../_shared/provider-crypto.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await resolveProviderActor(req, { adminOnly: true });
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const db = actor.supabaseAdmin;

  try {
    const body = await req.json().catch(() => ({}));
    const provider = String(body.provider ?? "") as SupportedProvider;
    if (!PLATFORM_FIELDS[provider]) return json({ error: "Unsupported provider" }, 400);

    const environment = normalizeEnvironment(body.environment);
    const incoming = (body.credentials ?? {}) as Record<string, unknown>;

    let config = await getPlatformConfig(db, provider, environment);
    if (!config) {
      const { data, error } = await db
        .from("provider_platform_configs")
        .insert({
          provider,
          environment,
          country: null,
          status: "draft",
          created_by: actor.userId,
          updated_by: actor.userId,
        })
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 400);
      config = data as typeof config;
    }

    // Merge: blank incoming values keep the stored secret rather than wiping it.
    const existing = (await loadPlatformCredentials(db, config!.id)) ?? {};
    const merged: Record<string, unknown> = { ...existing };
    for (const field of PLATFORM_FIELDS[provider]) {
      const value = incoming[field.key];
      if (typeof value === "string" && value.trim()) merged[field.key] = value.trim();
    }

    const { complete, missing } = validatePlatformCompleteness(provider, merged);
    await savePlatformCredentials(db, config!.id, merged);

    const masks = buildCredentialMasks(
      Object.fromEntries(
        PLATFORM_FIELDS[provider].map((f) => [f.key, merged[f.key] as string | undefined]),
      ),
    );

    const { data: updated, error: updErr } = await db
      .from("provider_platform_configs")
      .update({
        status: complete ? "configured" : "draft",
        is_complete: complete,
        missing_fields: missing,
        callback_url: providerCallbackUrl(),
        webhook_url: providerWebhookUrl(provider),
        return_url: providerReturnUrl(),
        credential_masks: masks,
        last_test_error: null,
        updated_by: actor.userId,
      })
      .eq("id", config!.id)
      .select("*")
      .single();
    if (updErr) return json({ error: updErr.message }, 400);

    await logProviderAudit(db, {
      provider,
      action: "configure",
      entityType: "platform_config",
      entityId: config!.id,
      actorId: actor.userId,
      summary: { environment, complete, missing, fields_supplied: Object.keys(incoming) },
      responseStatus: 200,
    });

    return json({ config: updated });
  } catch (err) {
    const keyErr = encryptionKeyErrorResponse(err);
    if (keyErr) return keyErr;
    console.error("admin-save-provider-platform-config failed", (err as Error).message);
    return json({ error: (err as Error).message }, 500);
  }
});
