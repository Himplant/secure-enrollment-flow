// Rotate credentials for a surgeon provider account.
//  * OAuth accounts: force a refresh-token exchange, replacing both tokens.
//  * Manual accounts: accept freshly typed values and overwrite the blob.
// Existing values are never returned.
import {
  accountMasks,
  actorMayManageSurgeon,
  corsHeaders,
  encryptionKeyErrorResponse,
  getPlatformConfig,
  json,
  loadAccountCredentials,
  loadPlatformCredentials,
  logProviderAudit,
  normalizeEnvironment,
  resolveProviderActor,
  saveAccountCredentials,
} from "../_shared/provider-config.ts";
import { mpRefreshToken } from "../_shared/providers/mercado-pago.ts";

const MANUAL_FIELDS = [
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

  const body = await req.json().catch(() => ({}));
  const accountId = String(body.accountId ?? "");
  if (!accountId) return json({ error: "accountId is required" }, 400);

  const { data: account } = await db
    .from("provider_accounts")
    .select("id, surgeon_id, provider, environment, connection_method")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return json({ error: "Provider account not found" }, 404);
  if (!actorMayManageSurgeon(actor, account.surgeon_id as string)) {
    return json({ error: "Surgeon is outside your scope" }, 403);
  }
  if (account.provider !== "mercado_pago") return json({ error: "Unsupported provider" }, 400);

  const environment = normalizeEnvironment(account.environment);

  try {
    const stored = (await loadAccountCredentials(db, accountId))?.credentials ?? {};

    const manual: Record<string, string> = {};
    for (const key of MANUAL_FIELDS) {
      const value = body.credentials?.[key];
      if (typeof value === "string" && value.trim()) manual[key] = value.trim();
    }

    let next = { ...stored, ...manual };
    let expiresAt: string | null = null;
    let scope: string | null = null;

    if (Object.keys(manual).length === 0) {
      // No new values supplied — perform an OAuth rotation instead.
      if (!stored.refresh_token) {
        return json({ error: "No refresh token on file; enter new credentials manually" }, 400);
      }
      const config = await getPlatformConfig(db, "mercado_pago", environment);
      const platform = config ? await loadPlatformCredentials(db, config.id) : null;
      if (!platform?.client_id || !platform?.client_secret) {
        return json({ error: "Platform credentials missing" }, 400);
      }
      const refreshed = await mpRefreshToken({
        clientId: platform.client_id,
        clientSecret: platform.client_secret,
        refreshToken: stored.refresh_token as string,
      });
      next = {
        ...stored,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? stored.refresh_token,
        public_key: refreshed.public_key ?? stored.public_key,
      };
      expiresAt = refreshed.expires_in
        ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
        : null;
      scope = refreshed.scope ?? null;
    }

    await saveAccountCredentials(db, accountId, next, { expiresAt, scope, environment });
    const masks = accountMasks(next);
    await db
      .from("provider_accounts")
      .update({
        credential_masks: masks,
        token_expires_at: expiresAt,
        scopes: scope,
        connection_error: null,
        status: "pending",
      })
      .eq("id", accountId);

    await logProviderAudit(db, {
      provider: "mercado_pago",
      action: "rotate",
      entityType: "provider_account",
      entityId: accountId,
      actorId: actor.userId,
      summary: { mode: Object.keys(manual).length ? "manual" : "oauth_refresh" },
      responseStatus: 200,
    });

    return json({
      ok: true,
      credential_masks: masks,
      message: "Credentials rotated. Run Test connection to re-verify.",
    });
  } catch (err) {
    const keyErr = encryptionKeyErrorResponse(err);
    if (keyErr) return keyErr;
    const message = (err as Error).message;
    await logProviderAudit(db, {
      provider: "mercado_pago",
      action: "rotate",
      entityType: "provider_account",
      entityId: accountId,
      actorId: actor.userId,
      responseStatus: 502,
      error: message,
    });
    return json({ ok: false, error: message }, 502);
  }
});
