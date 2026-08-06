// Refresh a surgeon's provider connection state: renews the OAuth token when
// it is near expiry and re-reads the merchant status. Returns metadata only.
import {
  actorMayManageSurgeon,
  corsHeaders,
  encryptionKeyErrorResponse,
  json,
  logProviderAudit,
  resolveProviderActor,
} from "../_shared/provider-config.ts";
import { mpGetUserMe, resolveMercadoPagoAccount } from "../_shared/providers/mercado-pago.ts";

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
    .select("id, surgeon_id, provider, environment, external_merchant_id, token_expires_at, status")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return json({ error: "Provider account not found" }, 404);
  if (!actorMayManageSurgeon(actor, account.surgeon_id as string)) {
    return json({ error: "Surgeon is outside your scope" }, 403);
  }
  if (account.provider !== "mercado_pago") return json({ error: "Unsupported provider" }, 400);

  try {
    // resolveMercadoPagoAccount performs the refresh-if-needed rotation.
    const resolved = await resolveMercadoPagoAccount(accountId);
    const me = await mpGetUserMe(resolved.accessToken);
    const now = new Date().toISOString();

    await db
      .from("provider_accounts")
      .update({
        status: "connected",
        connection_error: null,
        last_verified_at: now,
        live_mode: !!me.live_mode,
      })
      .eq("id", accountId);

    const { data: fresh } = await db
      .from("provider_accounts")
      .select(
        "id, status, external_merchant_id, token_expires_at, scopes, last_verified_at, last_tested_at, live_mode, environment, credential_masks",
      )
      .eq("id", accountId)
      .maybeSingle();

    await logProviderAudit(db, {
      provider: "mercado_pago",
      action: "refresh",
      entityType: "provider_account",
      entityId: accountId,
      actorId: actor.userId,
      responseStatus: 200,
    });

    return json({ ok: true, account: fresh });
  } catch (err) {
    const keyErr = encryptionKeyErrorResponse(err);
    if (keyErr) return keyErr;
    const message = (err as Error).message;
    await db
      .from("provider_accounts")
      .update({ status: "expired", connection_error: message.slice(0, 500) })
      .eq("id", accountId);
    await logProviderAudit(db, {
      provider: "mercado_pago",
      action: "refresh",
      entityType: "provider_account",
      entityId: accountId,
      actorId: actor.userId,
      responseStatus: 502,
      error: message,
    });
    return json({ ok: false, error: message }, 502);
  }
});
