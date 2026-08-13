// Live connection test. Calls Mercado Pago with the stored surgeon credentials,
// verifies the returned seller identity matches what we recorded, and updates
// connected/last_verified metadata. Saving credentials alone never marks an
// account connected — only this check does.
import { requireProviderEnabled } from "../_shared/flags.ts";
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
    .select("id, surgeon_id, provider, environment, external_merchant_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return json({ error: "Provider account not found" }, 404);
  if (!actorMayManageSurgeon(actor, account.surgeon_id as string)) {
    return json({ error: "Surgeon is outside your scope" }, 403);
  }
  if (account.provider !== "mercado_pago") return json({ error: "Unsupported provider" }, 400);
  const providerBlock = await requireProviderEnabled(String(account.provider));
  if (providerBlock) return providerBlock;

  try {
    const resolved = await resolveMercadoPagoAccount(accountId);
    const me = await mpGetUserMe(resolved.accessToken);
    const meId = me.id != null ? String(me.id) : null;
    const stored = account.external_merchant_id ? String(account.external_merchant_id) : null;
    const matches = !stored || !meId || stored === meId;
    const now = new Date().toISOString();

    if (!matches) {
      await db
        .from("provider_accounts")
        .update({
          status: "disabled",
          connection_error: "Seller identity does not match the stored merchant ID",
          last_tested_at: now,
        })
        .eq("id", accountId);
      await logProviderAudit(db, {
        provider: "mercado_pago",
        action: "test",
        entityType: "provider_account",
        entityId: accountId,
        actorId: actor.userId,
        summary: { matched: false },
        responseStatus: 409,
      });
      return json({ ok: false, error: "Seller identity mismatch", merchantId: meId }, 409);
    }

    await db
      .from("provider_accounts")
      .update({
        status: "connected",
        external_merchant_id: stored ?? meId,
        connection_error: null,
        last_tested_at: now,
        last_verified_at: now,
        live_mode: !!me.live_mode,
        capabilities: { checkout_pro: true, site_id: me.site_id ?? null },
      })
      .eq("id", accountId);

    await logProviderAudit(db, {
      provider: "mercado_pago",
      action: "test",
      entityType: "provider_account",
      entityId: accountId,
      actorId: actor.userId,
      summary: { matched: true, site_id: me.site_id ?? null },
      responseStatus: 200,
    });

    return json({
      ok: true,
      merchantId: stored ?? meId,
      nickname: (me.nickname as string | undefined) ?? null,
      siteId: (me.site_id as string | undefined) ?? null,
      liveMode: !!me.live_mode,
      lastVerifiedAt: now,
    });
  } catch (err) {
    const keyErr = encryptionKeyErrorResponse(err);
    if (keyErr) return keyErr;
    const message = (err as Error).message;
    await db
      .from("provider_accounts")
      .update({ connection_error: message.slice(0, 500), last_tested_at: new Date().toISOString() })
      .eq("id", accountId);
    await logProviderAudit(db, {
      provider: "mercado_pago",
      action: "test",
      entityType: "provider_account",
      entityId: accountId,
      actorId: actor.userId,
      responseStatus: 502,
      error: message,
    });
    return json({ ok: false, error: message }, 502);
  }
});
