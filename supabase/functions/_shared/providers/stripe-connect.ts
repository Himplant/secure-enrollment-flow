// Stripe Connect adapter for the International Consultations module.
//
// Money never touches Himplant. Every Checkout Session is created *directly on
// the surgeon's connected account* (`Stripe-Account` header = direct charges),
// so the funds settle into the surgeon's own Stripe balance and the surgeon is
// the merchant of record.
//
// This file is completely separate from the U.S. SecurePay Stripe flow:
//   * it never reads the U.S. Stripe environment secrets used by the domestic
//     checkout and webhook functions;
//   * it authenticates with the international platform credentials stored
//     (encrypted) in `provider_platform_configs` for `stripe_connect`;
//   * its webhooks arrive on `intl-payment-webhook`, never on `stripe-webhook`.
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
import { decimalsFor } from "./money.ts";
import {
  getPlatformConfig,
  loadPlatformCredentials,
  normalizeEnvironment,
  type ProviderEnvironment,
  serviceClient,
} from "../provider-config.ts";

const STRIPE_API = "https://api.stripe.com";
const STRIPE_API_VERSION = "2024-06-20";

/** Removes anything that could leak a key if an error string is ever surfaced. */
function scrub(message: string): string {
  return message
    .replace(/(sk|rk|whsec)_[A-Za-z0-9]{6,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9_\-]+/g, "Bearer [redacted]");
}

export interface StripePlatformContext {
  environment: ProviderEnvironment;
  secretKey: string;
  publishableKey: string | null;
  webhookSecret: string | null;
}

/** Loads and decrypts Himplant's INTERNATIONAL Stripe platform credentials. */
export async function loadStripePlatform(
  environment: ProviderEnvironment,
): Promise<StripePlatformContext> {
  const db = serviceClient();
  const config = await getPlatformConfig(db, "stripe_connect", environment);
  if (!config) throw new Error("Stripe Connect platform configuration is missing");
  const creds = await loadPlatformCredentials(db, config.id);
  const secretKey = String(creds?.secret_key ?? "");
  if (!secretKey) throw new Error("Stripe Connect platform credentials are incomplete");

  // A live key in the sandbox environment (or the reverse) would move real
  // money by accident — refuse before any API call is made.
  const isLiveKey = /^(sk|rk)_live_/.test(secretKey);
  if (isLiveKey !== (environment === "live")) {
    throw new Error(
      `The saved Stripe key does not match the ${environment} environment. ` +
        `Use a test key for sandbox and a live key for live.`,
    );
  }

  return {
    environment,
    secretKey,
    publishableKey: creds?.publishable_key ? String(creds.publishable_key) : null,
    webhookSecret: creds?.webhook_secret ? String(creds.webhook_secret) : null,
  };
}

function encodeForm(data: Record<string, unknown>, prefix = ""): string[] {
  const parts: string[] = [];
  for (const [rawKey, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const key = prefix ? `${prefix}[${rawKey}]` : rawKey;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") {
          parts.push(...encodeForm(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === "object") {
      parts.push(...encodeForm(value as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

export async function stripeFetch(
  ctx: StripePlatformContext,
  path: string,
  opts: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    /** Acts on behalf of a connected account (direct charges). */
    stripeAccount?: string | null;
    idempotencyKey?: string;
  } = {},
): Promise<Record<string, unknown>> {
  const method = opts.method ?? "GET";
  const encoded = opts.body ? encodeForm(opts.body).join("&") : "";
  const url = method === "GET" && encoded ? `${STRIPE_API}${path}?${encoded}` : `${STRIPE_API}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(opts.stripeAccount ? { "Stripe-Account": opts.stripeAccount } : {}),
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    },
    ...(method === "POST" ? { body: encoded } : {}),
  });

  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const message = (body.error as { message?: string } | undefined)?.message ?? text;
    throw new Error(`Stripe ${path} failed [${res.status}]: ${scrub(String(message)).slice(0, 400)}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Connected-account onboarding
// ---------------------------------------------------------------------------

/**
 * Creates a Standard connected account for a surgeon. Standard keeps the
 * surgeon as the account owner with their own Stripe dashboard, losses and
 * disputes — Himplant is only the platform.
 */
export async function stripeCreateConnectedAccount(params: {
  environment: ProviderEnvironment;
  country: string;
  email?: string | null;
  surgeonId: string;
  providerAccountId: string;
}): Promise<string> {
  const ctx = await loadStripePlatform(params.environment);
  const account = await stripeFetch(ctx, "/v1/accounts", {
    method: "POST",
    body: {
      type: "standard",
      country: params.country.toUpperCase(),
      ...(params.email ? { email: params.email } : {}),
      metadata: {
        himplant_surgeon_id: params.surgeonId,
        himplant_provider_account_id: params.providerAccountId,
        himplant_module: "international",
      },
    },
    idempotencyKey: `acct_${params.providerAccountId}`,
  });
  const id = String(account.id ?? "");
  if (!id) throw new Error("Stripe did not return a connected account id");
  return id;
}

/** One-time, short-lived hosted onboarding URL for the surgeon. */
export async function stripeCreateAccountLink(params: {
  environment: ProviderEnvironment;
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}): Promise<string> {
  const ctx = await loadStripePlatform(params.environment);
  const link = await stripeFetch(ctx, "/v1/account_links", {
    method: "POST",
    body: {
      account: params.accountId,
      refresh_url: params.refreshUrl,
      return_url: params.returnUrl,
      type: "account_onboarding",
      collection_options: { fields: "eventually_due" },
    },
  });
  const url = String(link.url ?? "");
  if (!url) throw new Error("Stripe did not return an onboarding URL");
  return url;
}

export async function stripeAccountStatus(params: {
  environment: ProviderEnvironment;
  accountId: string;
}): Promise<{
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  defaultCurrency: string | null;
  raw: Record<string, unknown>;
}> {
  const ctx = await loadStripePlatform(params.environment);
  const acct = await stripeFetch(ctx, `/v1/accounts/${encodeURIComponent(params.accountId)}`);
  const requirements = (acct.requirements as { disabled_reason?: string } | undefined) ?? {};
  return {
    chargesEnabled: acct.charges_enabled === true,
    payoutsEnabled: acct.payouts_enabled === true,
    detailsSubmitted: acct.details_submitted === true,
    disabledReason: requirements.disabled_reason ?? null,
    defaultCurrency: acct.default_currency ? String(acct.default_currency).toUpperCase() : null,
    raw: acct,
  };
}

/** Revokes the platform's access to the surgeon's Standard account. */
export async function stripeDisconnectAccount(params: {
  environment: ProviderEnvironment;
  accountId: string;
}): Promise<void> {
  const ctx = await loadStripePlatform(params.environment);
  await stripeFetch(ctx, `/v1/accounts/${encodeURIComponent(params.accountId)}`, {
    method: "POST",
    body: {},
  }).catch(() => undefined);
  // Standard accounts are detached, never deleted — the surgeon keeps their data.
  await stripeFetch(ctx, "/v1/oauth/deauthorize", {
    method: "POST",
    body: { stripe_user_id: params.accountId },
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Webhook signature verification (Stripe scheme v1, constant-time compare)
// ---------------------------------------------------------------------------

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyStripeConnectWebhook(params: {
  environment: ProviderEnvironment;
  signatureHeader: string | null;
  rawBody: string;
  toleranceSeconds?: number;
}): Promise<{ ok: boolean; reason?: string; event?: Record<string, unknown> }> {
  const ctx = await loadStripePlatform(params.environment);
  if (!ctx.webhookSecret) return { ok: false, reason: "webhook secret not configured" };
  if (!params.signatureHeader) return { ok: false, reason: "missing stripe-signature header" };

  const parts = Object.fromEntries(
    params.signatureHeader.split(",").map((p) => {
      const [k, ...rest] = p.trim().split("=");
      return [k, rest.join("=")];
    }),
  ) as Record<string, string>;

  const timestamp = parts.t;
  const signatures = params.signatureHeader
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));

  if (!timestamp || signatures.length === 0) return { ok: false, reason: "malformed signature" };

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > (params.toleranceSeconds ?? 300)) {
    return { ok: false, reason: "signature timestamp outside tolerance" };
  }

  const expected = await hmacHex(ctx.webhookSecret, `${timestamp}.${params.rawBody}`);
  if (!signatures.some((s) => timingSafeEqual(s, expected))) {
    return { ok: false, reason: "signature mismatch" };
  }

  try {
    return { ok: true, event: JSON.parse(params.rawBody) as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "invalid json" };
  }
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

export function normalizeStripeConnectStatus(providerStatus: string): IntlPaymentStatus {
  const s = (providerStatus || "").toLowerCase();
  const map: Record<string, IntlPaymentStatus> = {
    open: "processing",
    incomplete: "processing",
    requires_payment_method: "processing",
    requires_confirmation: "processing",
    requires_action: "processing",
    processing: "processing",
    requires_capture: "processing",
    complete: "approved",
    succeeded: "approved",
    paid: "approved",
    canceled: "canceled",
    expired: "expired",
    failed: "failed",
    refunded: "refunded",
    disputed: "disputed",
  };
  return map[s] ?? "processing";
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

async function resolveStripeAccount(providerAccountId: string) {
  const db = serviceClient();
  const { data: account } = await db
    .from("provider_accounts")
    .select("id, environment, external_merchant_id, status, is_active")
    .eq("id", providerAccountId)
    .maybeSingle();
  if (!account) throw new Error("Stripe account not found");
  if (!account.is_active || account.status !== "connected") {
    throw new Error("This Stripe account is not connected");
  }
  if (!account.external_merchant_id) {
    throw new Error("Stripe onboarding is not complete for this surgeon");
  }
  return {
    accountId: String(account.external_merchant_id),
    environment: normalizeEnvironment(account.environment),
  };
}

export const stripeConnectProvider: PaymentProvider = {
  name: "stripe_connect",

  // Onboarding runs through provider-connect-start / provider-refresh-status,
  // which own the account link and its one-time state.
  startMerchantConnection(): Promise<{ url: string; state: string }> {
    return Promise.reject(new NotSupportedError("Direct startMerchantConnection"));
  },
  completeMerchantConnection(): Promise<
    { externalMerchantId: string; capabilities: Record<string, unknown> }
  > {
    return Promise.reject(new NotSupportedError("Direct completeMerchantConnection"));
  },

  async getMerchantStatus(externalMerchantId: string) {
    if (!externalMerchantId) return { status: "pending" as const, capabilities: {} };
    const status = await stripeAccountStatus({
      environment: "live",
      accountId: externalMerchantId,
    }).catch(() => null);
    if (!status) return { status: "pending" as const, capabilities: {} };
    return {
      status: status.chargesEnabled ? ("connected" as const) : ("pending" as const),
      capabilities: {
        charges_enabled: status.chargesEnabled,
        payouts_enabled: status.payoutsEnabled,
        details_submitted: status.detailsSubmitted,
      },
    };
  },

  async disconnectMerchant(externalMerchantId: string) {
    if (!externalMerchantId) return;
    await stripeDisconnectAccount({ environment: "live", accountId: externalMerchantId });
  },

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (!req.providerAccountId) throw new Error("Stripe requires a connected surgeon account");
    const account = await resolveStripeAccount(req.providerAccountId);
    const ctx = await loadStripePlatform(account.environment);

    // Stripe expects the smallest unit for the currency; CLP is zero-decimal.
    const unitAmount = req.amountMinor;
    const currency = req.currency.toLowerCase();
    const expiresAtSec = req.expiresAt
      ? Math.floor(new Date(req.expiresAt).getTime() / 1000)
      : undefined;

    const session = await stripeFetch(ctx, "/v1/checkout/sessions", {
      method: "POST",
      // Direct charge: settles into the surgeon's own balance.
      stripeAccount: account.accountId,
      idempotencyKey: `intl_${req.consultationId}`,
      body: {
        mode: "payment",
        success_url: req.successUrl,
        cancel_url: req.failureUrl,
        client_reference_id: req.consultationId,
        ...(req.payerEmail ? { customer_email: req.payerEmail } : {}),
        // Stripe requires expiry to be 30min-24h out; the 48h consultation
        // gate is still enforced by us, so only pass a valid window.
        ...(expiresAtSec &&
            expiresAtSec > Math.floor(Date.now() / 1000) + 1800 &&
            expiresAtSec < Math.floor(Date.now() / 1000) + 86_400
          ? { expires_at: expiresAtSec }
          : {}),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: unitAmount,
              product_data: { name: req.description.slice(0, 250) },
            },
          },
        ],
        metadata: {
          consultation_id: req.consultationId,
          himplant_module: "international",
        },
        payment_intent_data: {
          metadata: {
            consultation_id: req.consultationId,
            himplant_module: "international",
          },
        },
      },
    });

    const url = String(session.url ?? "");
    if (!url) throw new Error("Stripe did not return a checkout URL");
    return {
      checkoutUrl: url,
      providerOrderId: String(session.id ?? "") || null,
      providerPaymentId: session.payment_intent ? String(session.payment_intent) : null,
    };
  },

  async getPayment(lookupId: string, ctxIn?: ProviderCallContext): Promise<NormalizedPayment> {
    if (!ctxIn?.providerAccountId) {
      throw new Error("Stripe lookups require the surgeon's provider account");
    }
    const account = await resolveStripeAccount(ctxIn.providerAccountId);
    const ctx = await loadStripePlatform(account.environment);

    const isSession = lookupId.startsWith("cs_");
    const path = isSession
      ? `/v1/checkout/sessions/${encodeURIComponent(lookupId)}`
      : `/v1/payment_intents/${encodeURIComponent(lookupId)}`;
    const obj = await stripeFetch(ctx, path, { stripeAccount: account.accountId });

    const rawStatus = isSession
      ? String(obj.payment_status ?? obj.status ?? "")
      : String(obj.status ?? "");
    const currency = obj.currency ? String(obj.currency).toUpperCase() : null;
    const amount = isSession ? obj.amount_total : obj.amount_received ?? obj.amount;
    const metadata = (obj.metadata as Record<string, string> | undefined) ?? {};

    return {
      providerPaymentId: isSession
        ? (obj.payment_intent ? String(obj.payment_intent) : null)
        : String(obj.id ?? ""),
      providerOrderId: isSession ? String(obj.id ?? "") : null,
      status: normalizeStripeConnectStatus(rawStatus),
      // Stripe already reports amounts in the currency's smallest unit.
      amountMinor: typeof amount === "number" ? amount : null,
      currency,
      recipientMerchantId: account.accountId,
      externalReference:
        (obj.client_reference_id as string | undefined) ?? metadata.consultation_id ?? null,
      raw: obj,
    };
  },

  async verifyWebhook(req: Request, rawBody: string): Promise<WebhookVerification> {
    // Both environments share one endpoint; try the environment declared on the
    // request first, then fall back so a mis-tagged endpoint is not silently lost.
    const declared = normalizeEnvironment(new URL(req.url).searchParams.get("environment"));
    const order: ProviderEnvironment[] = declared === "live" ? ["live", "sandbox"] : ["sandbox", "live"];

    let lastReason = "signature mismatch";
    for (const environment of order) {
      const result = await verifyStripeConnectWebhook({
        environment,
        signatureHeader: req.headers.get("stripe-signature"),
        rawBody,
      }).catch((e) => ({ ok: false as const, reason: scrub((e as Error).message) }));

      if (result.ok && result.event) {
        const event = result.event;
        const object = ((event.data as { object?: Record<string, unknown> } | undefined)?.object) ?? {};
        const lookupId = String(object.id ?? "") || null;
        return {
          ok: true,
          eventId: String(event.id ?? "") || null,
          lookupId,
        };
      }
      lastReason = result.reason ?? lastReason;
    }
    return { ok: false, eventId: null, lookupId: null, reason: lastReason };
  },

  normalizePaymentStatus: normalizeStripeConnectStatus,

  getAvailablePaymentMethods(country: string): string[] {
    const c = (country || "").toUpperCase();
    if (c === "MX") return ["card", "oxxo"];
    if (c === "CL") return ["card"];
    if (c === "CO") return ["card"];
    return ["card"];
  },

  refundPayment(): Promise<never> {
    return Promise.reject(
      new NotSupportedError("Refunds for the international consultation fee"),
    );
  },
};
