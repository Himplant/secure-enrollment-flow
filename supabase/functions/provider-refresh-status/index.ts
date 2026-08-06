// Refresh a surgeon's provider connection state: renews the OAuth token when
// it is near expiry and re-reads the merchant status. Returns metadata only.
import {
  actorMayManageSurgeon,
  corsHeaders,
  encryptionKeyErrorResponse,
  json,
  logProviderAudit,
  normalizeEnvironment,
  resolveProviderActor,
} from "../_shared/provider-config.ts";
import { mpGetUserMe, resolveMercadoPagoAccount } from "../_shared/providers/mercado-pago.ts";
import { paypalMerchantStatus } from "../_shared/providers/paypal.ts";
import { stripeAccountStatus } from "../_shared/providers/stripe-connect.ts";

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
  if (
    account.provider !== "mercado_pago" &&
    account.provider !== "paypal" &&
    account.provider !== "stripe_connect"
  ) {
    return json({ error: "Unsupported provider" }, 400);
  }

  const readBack = async () => {
    const { data } = await db
      .from("provider_accounts")
      .select(
        "id, status, external_merchant_id, token_expires_at, scopes, last_verified_at, last_tested_at, live_mode, environment, credential_masks, onboarding_status, onboarding_url, connection_error",
      )
      .eq("id", accountId)
      .maybeSingle();
    return data;
  };

  // ---- PayPal: poll partner onboarding status -----------------------------
  if (account.provider === "paypal") {
    try {
      const environment = normalizeEnvironment(account.environment);
      const status = await paypalMerchantStatus({ environment, trackingId: accountId });
      const ready = !!status.merchantId && status.paymentsReceivable;
      const now = new Date().toISOString();

      await db
        .from("provider_accounts")
        .update({
          external_merchant_id: status.merchantId,
          status: ready ? "connected" : "onboarding",
          onboarding_status: ready
            ? "connected"
            : status.merchantId
            ? "payments_not_receivable"
            : "awaiting_merchant",
          connection_error: null,
          live_mode: environment === "live",
          last_verified_at: now,
          ...(ready ? { connected_at: now, onboarding_url: null } : {}),
          capabilities: {
            orders_v2: true,
            payments_receivable: status.paymentsReceivable,
            email_confirmed: status.emailConfirmed,
          },
        })
        .eq("id", accountId);

      await logProviderAudit(db, {
        provider: "paypal",
        action: "refresh",
        entityType: "provider_account",
        entityId: accountId,
        actorId: actor.userId,
        summary: { ready },
        responseStatus: 200,
      });

      return json({ ok: true, account: await readBack() });
    } catch (err) {
      const message = (err as Error).message;
      await db
        .from("provider_accounts")
        .update({ connection_error: message.slice(0, 500) })
        .eq("id", accountId);
      await logProviderAudit(db, {
        provider: "paypal",
        action: "refresh",
        entityType: "provider_account",
        entityId: accountId,
        actorId: actor.userId,
        responseStatus: 502,
        error: message,
      });
      return json({ ok: false, error: message }, 502);
    }
  }

  // ---- Stripe Connect: poll the connected account's capabilities ----------
  if (account.provider === "stripe_connect") {
    const stripeAccountId = account.external_merchant_id as string | null;
    if (!stripeAccountId) {
      return json({ ok: false, error: "Stripe onboarding has not been started" }, 400);
    }
    try {
      const environment = normalizeEnvironment(account.environment);
      const status = await stripeAccountStatus({ environment, accountId: stripeAccountId });
      const ready = status.chargesEnabled && status.detailsSubmitted;
      const now = new Date().toISOString();

      await db
        .from("provider_accounts")
        .update({
          status: ready ? "connected" : "onboarding",
          onboarding_status: ready
            ? "connected"
            : status.detailsSubmitted
            ? "charges_disabled"
            : "awaiting_merchant",
          connection_error: status.disabledReason,
          live_mode: environment === "live",
          last_verified_at: now,
          ...(ready ? { connected_at: now, onboarding_url: null } : {}),
          capabilities: {
            checkout_sessions: true,
            direct_charges: true,
            charges_enabled: status.chargesEnabled,
            payouts_enabled: status.payoutsEnabled,
            details_submitted: status.detailsSubmitted,
            default_currency: status.defaultCurrency,
          },
        })
        .eq("id", accountId);

      await logProviderAudit(db, {
        provider: "stripe_connect",
        action: "refresh",
        entityType: "provider_account",
        entityId: accountId,
        actorId: actor.userId,
        summary: { ready },
        responseStatus: 200,
      });

      return json({ ok: true, account: await readBack() });
    } catch (err) {
      const message = (err as Error).message;
      await db
        .from("provider_accounts")
        .update({ connection_error: message.slice(0, 500) })
        .eq("id", accountId);
      await logProviderAudit(db, {
        provider: "stripe_connect",
        action: "refresh",
        entityType: "provider_account",
        entityId: accountId,
        actorId: actor.userId,
        responseStatus: 502,
        error: message,
      });
      return json({ ok: false, error: message }, 502);
    }
  }



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
