// Mercado Pago adapter (Checkout Pro + marketplace OAuth).
//
// Every call is made with the *surgeon's own* OAuth access token, loaded and
// decrypted per request from `private.provider_credentials`. Platform
// (application) credentials are only ever used for the OAuth token endpoints.
//
// Secrets never appear in URLs we log, in error strings, in events, or in any
// response body.
import {
  type CheckoutRequest,
  type CheckoutResult,
  type IntlPaymentStatus,
  type NormalizedPayment,
  NotSupportedError,
  type PaymentProvider,
  type ProviderCallContext,
  type WebhookVerification,
} from "./types.ts";
import {
  getPlatformConfig,
  loadAccountCredentials,
  loadPlatformCredentials,
  normalizeEnvironment,
  type ProviderEnvironment,
  saveAccountCredentials,
  serviceClient,
} from "../provider-config.ts";
import { hmacSha256Hex, timingSafeEqual } from "../provider-crypto.ts";

export const MP_API = "https://api.mercadopago.com";
export const MP_AUTH = "https://auth.mercadopago.com/authorization";

export interface MpTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  user_id?: number | string;
  public_key?: string;
  live_mode?: boolean;
}

function scrub(message: string): string {
  // Defensive: strip anything token-shaped out of provider error text.
  return message
    .replace(/APP_USR-[A-Za-z0-9-]+/g, "[redacted]")
    .replace(/TEST-[A-Za-z0-9-]+/g, "[redacted]");
}

async function mpFetch(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Record<string, unknown>> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${MP_API}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Mercado Pago ${path} failed [${res.status}]: ${scrub(text).slice(0, 500)}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function mpAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
}): string {
  const url = new URL(MP_AUTH);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("state", params.state);
  url.searchParams.set("redirect_uri", params.redirectUri);
  if (params.codeChallenge) {
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export async function mpExchangeCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string | null;
}): Promise<MpTokenResponse> {
  return (await mpFetch("/oauth/token", {
    method: "POST",
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      ...(params.codeVerifier ? { code_verifier: params.codeVerifier } : {}),
    }),
  })) as unknown as MpTokenResponse;
}

export async function mpRefreshToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<MpTokenResponse> {
  return (await mpFetch("/oauth/token", {
    method: "POST",
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
    }),
  })) as unknown as MpTokenResponse;
}

export async function mpGetUserMe(accessToken: string): Promise<Record<string, unknown>> {
  return await mpFetch("/users/me", { token: accessToken });
}

// ---------------------------------------------------------------------------
// Per-surgeon token resolution (with automatic refresh)
// ---------------------------------------------------------------------------

export interface ResolvedMpAccount {
  accountId: string;
  accessToken: string;
  merchantId: string | null;
  environment: ProviderEnvironment;
}

const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export async function resolveMercadoPagoAccount(accountId: string): Promise<ResolvedMpAccount> {
  const db = serviceClient();
  const { data: account, error } = await db
    .from("provider_accounts")
    .select("id, provider, environment, external_merchant_id, token_expires_at, is_active")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Provider account lookup failed: ${error.message}`);
  if (!account) throw new Error("Provider account not found");
  if (account.provider !== "mercado_pago") throw new Error("Provider account is not Mercado Pago");

  const environment = normalizeEnvironment(account.environment);
  const stored = await loadAccountCredentials(db, accountId);
  if (!stored?.credentials?.access_token) {
    throw new Error("Mercado Pago account has no stored credentials");
  }

  let accessToken = stored.credentials.access_token as string;
  const expiresAt = stored.expiresAt ? Date.parse(stored.expiresAt) : NaN;
  const needsRefresh =
    Number.isFinite(expiresAt) && expiresAt - Date.now() < EXPIRY_SKEW_MS &&
    !!stored.credentials.refresh_token;

  if (needsRefresh) {
    const config = await getPlatformConfig(db, "mercado_pago", environment);
    const platform = config ? await loadPlatformCredentials(db, config.id) : null;
    if (platform?.client_id && platform?.client_secret) {
      const refreshed = await mpRefreshToken({
        clientId: platform.client_id,
        clientSecret: platform.client_secret,
        refreshToken: stored.credentials.refresh_token as string,
      });
      accessToken = refreshed.access_token;
      const newExpiry = refreshed.expires_in
        ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
        : null;
      // Atomically replace BOTH tokens when the provider rotates them.
      await saveAccountCredentials(
        db,
        accountId,
        {
          ...stored.credentials,
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token ?? stored.credentials.refresh_token,
          public_key: refreshed.public_key ?? stored.credentials.public_key,
        },
        { expiresAt: newExpiry, scope: refreshed.scope ?? stored.scope, environment },
      );
      await db
        .from("provider_accounts")
        .update({ token_expires_at: newExpiry, connection_error: null })
        .eq("id", accountId);
    }
  }

  return {
    accountId,
    accessToken,
    merchantId: account.external_merchant_id ?? null,
    environment,
  };
}

// ---------------------------------------------------------------------------
// Webhook signature (official HMAC SHA-256 manifest)
// ---------------------------------------------------------------------------

export interface MpSignatureInput {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
  toleranceSeconds?: number;
  nowMs?: number;
}

export async function verifyMercadoPagoSignature(
  input: MpSignatureInput,
): Promise<{ ok: boolean; reason?: string }> {
  if (!input.secret) return { ok: false, reason: "webhook secret not configured" };
  if (!input.xSignature) return { ok: false, reason: "missing x-signature" };

  const parts = Object.fromEntries(
    input.xSignature.split(",").map((p) => {
      const idx = p.indexOf("=");
      return [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
    }),
  ) as Record<string, string>;

  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return { ok: false, reason: "malformed x-signature" };

  const tolerance = (input.toleranceSeconds ?? 300) * 1000;
  const now = input.nowMs ?? Date.now();
  const tsMs = Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > tolerance) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  // Official manifest: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
  let manifest = "";
  if (input.dataId) manifest += `id:${input.dataId.toLowerCase()};`;
  if (input.xRequestId) manifest += `request-id:${input.xRequestId};`;
  manifest += `ts:${ts};`;

  const expected = await hmacSha256Hex(input.secret, manifest);
  return timingSafeEqual(expected, v1)
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

export function normalizeMercadoPagoStatus(
  providerStatus: string,
  statusDetail?: string | null,
): IntlPaymentStatus {
  const s = (providerStatus || "").toLowerCase();
  if (s === "charged_back" || s === "in_mediation" || s === "dispute") return "disputed";
  const map: Record<string, IntlPaymentStatus> = {
    pending: "processing",
    in_process: "processing",
    authorized: "processing",
    approved: "approved",
    rejected: "failed",
    cancelled: "canceled",
    canceled: "canceled",
    refunded: "refunded",
    expired: "expired",
  };
  if (s === "cancelled" || s === "canceled") {
    if ((statusDetail ?? "").toLowerCase().includes("expired")) return "expired";
  }
  return map[s] ?? "processing";
}

function minorFromMajor(value: unknown, currency: string): number | null {
  if (typeof value !== "number") return null;
  // MX/CO/CL consultation currencies all use 2-decimal minor units in our schema.
  return Math.round(value * 100);
}

// ---------------------------------------------------------------------------
// Webhook routing helpers
// ---------------------------------------------------------------------------

/**
 * Per-payment notification URL. Mercado Pago supports dynamic query params on
 * `notification_url` for payment-platform / multiple-seller setups, and the
 * per-payment URL takes precedence over the application-level one.
 *
 * The params are ROUTING HINTS: which platform webhook secret to verify with,
 * and which seller access token to re-fetch the payment with. They never
 * influence approval, which is always decided from the authoritative payment
 * fetched back from Mercado Pago.
 */
export function mercadoPagoNotificationUrl(params: {
  baseUrl: string;
  environment: ProviderEnvironment;
  providerAccountId: string;
}): string {
  const url = new URL(
    `${params.baseUrl.replace(/\/$/, "")}/functions/v1/intl-payment-webhook`,
  );
  url.protocol = "https:";
  url.searchParams.set("provider", "mercado_pago");
  url.searchParams.set("environment", params.environment);
  url.searchParams.set("provider_account_id", params.providerAccountId);
  return url.toString();
}

/**
 * Environments to attempt signature verification against. An explicit param
 * pins exactly one — a live event is never checked against a sandbox secret.
 * Legacy URLs without the param fall back to trying both (live first).
 */
export function mercadoPagoWebhookEnvironments(
  environmentParam: string | null,
): ProviderEnvironment[] {
  if (environmentParam === "live") return ["live"];
  if (environmentParam === "sandbox") return ["sandbox"];
  return ["live", "sandbox"];
}


// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const mercadoPagoProvider: PaymentProvider = {
  name: "mercado_pago",

  // Connection lifecycle is driven by the dedicated provider-connect-* edge
  // functions, which own one-time state and PKCE. These interface methods
  // intentionally refuse to duplicate that surface.
  startMerchantConnection(): Promise<{ url: string; state: string }> {
    return Promise.reject(new NotSupportedError("Direct startMerchantConnection"));
  },
  completeMerchantConnection(): Promise<{ externalMerchantId: string; capabilities: Record<string, unknown> }> {
    return Promise.reject(new NotSupportedError("Direct completeMerchantConnection"));
  },

  async getMerchantStatus(externalMerchantId: string) {
    return {
      status: externalMerchantId ? ("connected" as const) : ("pending" as const),
      capabilities: { checkout_pro: true },
    };
  },

  async disconnectMerchant() {
    /* Mercado Pago revocation is performed by the seller in their MP account. */
  },

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (!req.providerAccountId) throw new Error("Mercado Pago requires a connected surgeon account");
    const account = await resolveMercadoPagoAccount(req.providerAccountId);

    const body: Record<string, unknown> = {
      items: [
        {
          id: req.consultationId,
          title: req.description,
          quantity: 1,
          currency_id: req.currency,
          unit_price: req.amountMinor / 100,
        },
      ],
      // Immutable consultation id — the only join key we trust on the way back.
      external_reference: req.consultationId,
      back_urls: {
        success: req.successUrl,
        pending: req.pendingUrl,
        failure: req.failureUrl,
      },
      auto_return: "approved",
      binary_mode: false,
      // Per-payment notification_url (takes precedence over the application
      // level URL). The extra query params are ROUTING HINTS ONLY — they pick
      // the right platform webhook secret and the right seller access token.
      // Nothing about approval is ever trusted from them.
      notification_url: mercadoPagoNotificationUrl({
        baseUrl: Deno.env.get("SUPABASE_URL")!,
        environment: account.environment,
        providerAccountId: account.accountId,
      }),
      ...(req.payerEmail || req.payerName
        ? { payer: { email: req.payerEmail ?? undefined, name: req.payerName ?? undefined } }
        : {}),
      // Our 48-hour consultation link remains the authoritative gate; this
      // simply keeps the provider preference from outliving it.
      ...(req.expiresAt
        ? { expires: true, expiration_date_to: new Date(req.expiresAt).toISOString() }
        : {}),
    };

    const pref = await mpFetch("/checkout/preferences", {
      method: "POST",
      token: account.accessToken,
      body: JSON.stringify(body),
    });

    const checkoutUrl = (req.environment === "live"
      ? (pref.init_point as string | undefined)
      : (pref.sandbox_init_point as string | undefined) ?? (pref.init_point as string | undefined)) ??
      (pref.init_point as string | undefined);

    if (!checkoutUrl) throw new Error("Mercado Pago did not return a checkout URL");

    return {
      checkoutUrl,
      providerOrderId: (pref.id as string | undefined) ?? null,
      providerPaymentId: null,
    };
  },

  async getPayment(lookupId: string, ctx?: ProviderCallContext): Promise<NormalizedPayment> {
    if (!ctx?.providerAccountId) throw new Error("Mercado Pago lookup requires a provider account");
    const account = await resolveMercadoPagoAccount(ctx.providerAccountId);
    const payment = await mpFetch(`/v1/payments/${encodeURIComponent(lookupId)}`, {
      token: account.accessToken,
    });

    const currency = (payment.currency_id as string | undefined) ?? null;
    const collector = payment.collector_id ?? (payment as { collector?: { id?: unknown } }).collector?.id ?? null;

    return {
      providerPaymentId: payment.id != null ? String(payment.id) : null,
      providerOrderId: (payment.order as { id?: unknown } | undefined)?.id != null
        ? String((payment.order as { id?: unknown }).id)
        : null,
      status: normalizeMercadoPagoStatus(
        String(payment.status ?? ""),
        (payment.status_detail as string | undefined) ?? null,
      ),
      amountMinor: minorFromMajor(
        (payment.transaction_amount as number | undefined) ?? undefined,
        currency ?? "",
      ),
      currency,
      recipientMerchantId: collector != null ? String(collector) : null,
      externalReference: (payment.external_reference as string | undefined) ?? null,
      raw: {
        id: payment.id,
        status: payment.status,
        status_detail: payment.status_detail,
        live_mode: payment.live_mode,
        currency_id: payment.currency_id,
        transaction_amount: payment.transaction_amount,
        external_reference: payment.external_reference,
        collector_id: collector,
        date_approved: payment.date_approved,
      },
    };
  },

  async verifyWebhook(req: Request, rawBody: string): Promise<WebhookVerification> {
    const url = new URL(req.url);
    // The environment is taken from the explicit query param so that a LIVE
    // event is always verified with the LIVE webhook secret. When the param is
    // absent (legacy application-level URL) we try each configured
    // environment; a secret can only ever validate its own signatures.
    const environments = mercadoPagoWebhookEnvironments(url.searchParams.get("environment"));
    const db = serviceClient();

    let parsed: Record<string, unknown> = {};
    try {
      parsed = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return { ok: false, eventId: null, lookupId: null, reason: "invalid json" };
    }

    const dataId =
      url.searchParams.get("data.id") ??
      ((parsed.data as { id?: unknown } | undefined)?.id != null
        ? String((parsed.data as { id?: unknown }).id)
        : null);

    let lastReason = "platform not configured";
    let verified = false;

    for (const environment of environments) {
      const config = await getPlatformConfig(db, "mercado_pago", environment);
      if (!config) continue;
      const platform = await loadPlatformCredentials(db, config.id);
      const secret = (platform?.webhook_secret as string | undefined) ?? "";

      const verification = await verifyMercadoPagoSignature({
        xSignature: req.headers.get("x-signature"),
        xRequestId: req.headers.get("x-request-id"),
        dataId,
        secret,
      });
      if (verification.ok) {
        verified = true;
        break;
      }
      lastReason = verification.reason ?? "signature mismatch";
    }

    if (!verified) {
      return { ok: false, eventId: null, lookupId: null, reason: lastReason };
    }


    return {
      ok: true,
      eventId: parsed.id != null ? String(parsed.id) : `${dataId ?? "mp"}:${req.headers.get("x-request-id") ?? ""}`,
      lookupId: dataId,
    };
  },

  normalizePaymentStatus(providerStatus: string): IntlPaymentStatus {
    return normalizeMercadoPagoStatus(providerStatus);
  },

  getAvailablePaymentMethods(country: string): string[] {
    const base = ["credit_card", "debit_card"];
    if (country === "MX") return [...base, "oxxo", "spei", "mercado_pago_wallet"];
    if (country === "CO") return [...base, "pse", "efecty", "mercado_pago_wallet"];
    if (country === "CL") return [...base, "webpay", "mercado_pago_wallet"];
    return base;
  },

  async refundPayment(): Promise<never> {
    throw new NotSupportedError("Refund");
  },
};
