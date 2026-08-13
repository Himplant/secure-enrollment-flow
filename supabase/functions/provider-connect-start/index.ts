// Begin a merchant connection for a surgeon's own payment account.
//
//  * Mercado Pago — OAuth with a one-time, expiring `state` plus a PKCE
//    verifier kept server-side only; returns the authorization URL.
//  * PayPal — Commerce Platform partner onboarding; creates (or reuses) the
//    surgeon's pending provider account and returns the referral action URL.
//    Its tracking id is the account id, which the status poll reads back.
import { requireProviderEnabled } from "../_shared/flags.ts";
import {
  actorMayManageSurgeon,
  corsHeaders,
  encryptionKeyErrorResponse,
  getPlatformConfig,
  json,
  loadPlatformCredentials,
  logProviderAudit,
  normalizeEnvironment,
  providerCallbackUrl,
  resolveConnectReturnUrl,
  resolveProviderActor,
} from "../_shared/provider-config.ts";
import {
  codeChallengeS256,
  generateCodeVerifier,
  generateOAuthState,
} from "../_shared/provider-crypto.ts";
import { mpAuthorizationUrl } from "../_shared/providers/mercado-pago.ts";
import { paypalCreatePartnerReferral } from "../_shared/providers/paypal.ts";
import {
  stripeCreateAccountLink,
  stripeCreateConnectedAccount,
} from "../_shared/providers/stripe-connect.ts";

const CURRENCY_BY_COUNTRY: Record<string, string> = { MX: "MXN", CO: "COP", CL: "CLP" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await resolveProviderActor(req);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const db = actor.supabaseAdmin;

  try {
    const body = await req.json().catch(() => ({}));
    const provider = String(body.provider ?? "mercado_pago");
    if (provider !== "mercado_pago" && provider !== "paypal" && provider !== "stripe_connect") {
      return json({ error: "Unsupported provider" }, 400);
    }

    // Runtime feature flag, enforced server-side: a provider that is switched
    // off cannot be connected even by calling this endpoint directly.
    const providerBlock = await requireProviderEnabled(provider);
    if (providerBlock) return providerBlock;

    const connectReturnUrl = resolveConnectReturnUrl(actor.kind, body.origin);

    const surgeonId = String(body.surgeonId ?? "");
    if (!surgeonId) return json({ error: "surgeonId is required" }, 400);
    if (!actorMayManageSurgeon(actor, surgeonId)) {
      return json({ error: "Surgeon is outside your scope" }, 403);
    }

    const environment = normalizeEnvironment(body.environment);
    const config = await getPlatformConfig(db, provider, environment);
    if (!config) {
      return json({
        error: `No ${provider} platform configuration exists for the ${environment} environment. ` +
          `Save the ${provider} platform credentials in Providers → Platform setup before connecting a surgeon.`,
      }, 400);
    }
    if (!config.is_complete) {
      const missing = (config.missing_fields ?? []).join(", ") || "required credentials";
      return json({
        error: `${provider} platform configuration is incomplete — missing: ${missing}. ` +
          `Add them in Providers → Platform setup (${environment}).`,
      }, 400);
    }

    // ---- Stripe Connect: hosted Standard-account onboarding ----------------
    if (provider === "stripe_connect") {
      const { data: surgeon } = await db
        .from("surgeons")
        .select("id, country, currency, email")
        .eq("id", surgeonId)
        .maybeSingle();
      const country = String(surgeon?.country ?? "").toUpperCase();
      if (!CURRENCY_BY_COUNTRY[country]) {
        return json({ error: "Surgeon country is not supported" }, 400);
      }
      const currency = String(surgeon?.currency ?? "").toUpperCase() || CURRENCY_BY_COUNTRY[country];

      const { data: existing } = await db
        .from("provider_accounts")
        .select("id, external_merchant_id")
        .eq("surgeon_id", surgeonId)
        .eq("provider", provider)
        .eq("environment", environment)
        .maybeSingle();

      let accountId = existing?.id as string | undefined;
      if (!accountId) {
        const { data: created, error: createErr } = await db
          .from("provider_accounts")
          .insert({
            surgeon_id: surgeonId,
            provider,
            country,
            currency,
            environment,
            connection_method: "partner_onboarding",
            status: "onboarding",
            onboarding_status: "account_created",
            platform_config_id: config.id,
            connected_by: actor.userId,
            is_active: false,
          })
          .select("id")
          .single();
        if (createErr) return json({ error: createErr.message }, 500);
        accountId = created.id as string;
      }

      // Reuse the surgeon's connected account whenever one already exists —
      // creating a second Stripe account would split their payouts.
      let stripeAccountId = existing?.external_merchant_id as string | null | undefined;
      if (!stripeAccountId) {
        stripeAccountId = await stripeCreateConnectedAccount({
          environment,
          country,
          email: (surgeon?.email as string | null) ?? null,
          surgeonId,
          providerAccountId: accountId!,
        });
      }

      const returnUrl = connectReturnUrl;
      const url = await stripeCreateAccountLink({
        environment,
        accountId: stripeAccountId,
        refreshUrl: returnUrl,
        returnUrl,
      });

      await db
        .from("provider_accounts")
        .update({
          external_merchant_id: stripeAccountId,
          status: "onboarding",
          onboarding_status: "awaiting_merchant",
          onboarding_url: url,
          connection_error: null,
          platform_config_id: config.id,
          live_mode: environment === "live",
        })
        .eq("id", accountId!);

      await logProviderAudit(db, {
        provider,
        action: "connect_start",
        entityType: "provider_account",
        entityId: accountId!,
        actorId: actor.userId,
        summary: { surgeon_id: surgeonId, environment, method: "stripe_account_link" },
        responseStatus: 200,
      });

      return json({ url, accountId, method: "partner_onboarding" });
    }


    // ---- PayPal: partner onboarding referral -------------------------------
    if (provider === "paypal") {
      const { data: surgeon } = await db
        .from("surgeons")
        .select("id, country, currency, email")
        .eq("id", surgeonId)
        .maybeSingle();
      const country = String(surgeon?.country ?? "").toUpperCase();
      if (!CURRENCY_BY_COUNTRY[country]) {
        return json({ error: "Surgeon country is not supported" }, 400);
      }
      const currency = String(surgeon?.currency ?? "").toUpperCase() || CURRENCY_BY_COUNTRY[country];

      const { data: existing } = await db
        .from("provider_accounts")
        .select("id")
        .eq("surgeon_id", surgeonId)
        .eq("provider", provider)
        .eq("environment", environment)
        .maybeSingle();

      let accountId = existing?.id as string | undefined;
      if (!accountId) {
        const { data: created, error: createErr } = await db
          .from("provider_accounts")
          .insert({
            surgeon_id: surgeonId,
            provider,
            country,
            currency,
            environment,
            connection_method: "partner_onboarding",
            status: "onboarding",
            onboarding_status: "referral_created",
            platform_config_id: config.id,
            connected_by: actor.userId,
            is_active: false,
          })
          .select("id")
          .single();
        if (createErr) return json({ error: createErr.message }, 500);
        accountId = created.id as string;
      } else {
        await db
          .from("provider_accounts")
          .update({
            status: "onboarding",
            onboarding_status: "referral_created",
            connection_error: null,
            platform_config_id: config.id,
          })
          .eq("id", accountId);
      }

      const referral = await paypalCreatePartnerReferral({
        environment,
        trackingId: accountId!,
        returnUrl: connectReturnUrl,
        email: (surgeon?.email as string | null) ?? null,
        country,
      });

      await db
        .from("provider_accounts")
        .update({ onboarding_url: referral.actionUrl })
        .eq("id", accountId!);

      await logProviderAudit(db, {
        provider,
        action: "connect_start",
        entityType: "provider_account",
        entityId: accountId!,
        actorId: actor.userId,
        summary: { surgeon_id: surgeonId, environment, method: "partner_onboarding" },
        responseStatus: 200,
      });

      return json({ url: referral.actionUrl, accountId, method: "partner_onboarding" });
    }

    // ---- Mercado Pago: OAuth + PKCE ----------------------------------------
    const platform = await loadPlatformCredentials(db, config.id);
    if (!platform?.client_id) return json({ error: "Platform Application ID missing" }, 400);

    const state = generateOAuthState();
    const usePkce = body.usePkce !== false;
    const verifier = usePkce ? generateCodeVerifier() : null;
    const challenge = verifier ? await codeChallengeS256(verifier) : undefined;

    const { error: stateErr } = await db.rpc("create_provider_oauth_state", {
      _state: state,
      _provider: provider,
      _environment: environment,
      _surgeon_id: surgeonId,
      _platform_config_id: config.id,
      _code_verifier: verifier,
      _redirect_after: connectReturnUrl,
      _created_by: actor.userId,
      _created_by_email: actor.email,
      _ttl_seconds: 600,
    });
    if (stateErr) return json({ error: stateErr.message }, 500);

    const url = mpAuthorizationUrl({
      clientId: platform.client_id,
      redirectUri: config.callback_url ?? providerCallbackUrl(),
      state,
      codeChallenge: challenge,
    });

    await logProviderAudit(db, {
      provider,
      action: "connect_start",
      entityType: "provider_account",
      entityId: null,
      actorId: actor.userId,
      summary: { surgeon_id: surgeonId, environment, pkce: !!verifier },
      responseStatus: 200,
    });

    return json({ url, expiresInSeconds: 600 });
  } catch (err) {
    const keyErr = encryptionKeyErrorResponse(err);
    if (keyErr) return keyErr;
    console.error("provider-connect-start failed", (err as Error).message);
    return json({ error: (err as Error).message }, 500);
  }
});
