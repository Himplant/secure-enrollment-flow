// PayPal adapter (Commerce Platform / multiparty "payee" model).
//
// Money never touches Himplant: every order is created with an explicit
// `payee.merchant_id` pointing at the surgeon's own onboarded PayPal merchant
// account. Himplant's platform credentials are used only to authenticate the
// API call and to run partner onboarding.
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
  loadPlatformCredentials,
  normalizeEnvironment,
  type ProviderEnvironment,
  serviceClient,
} from "../provider-config.ts";

export const PAYPAL_LIVE = "https://api-m.paypal.com";
export const PAYPAL_SANDBOX = "https://api-m.sandbox.paypal.com";

export function paypalApiBase(environment: ProviderEnvironment): string {
  return environment === "live" ? PAYPAL_LIVE : PAYPAL_SANDBOX;
}

function scrub(message: string): string {
  return message
    .replace(/A2[0-9A-Za-z._-]{20,}/g, "[redacted]")
    .replace(/access_token"\s*:\s*"[^"]+"/g, 'access_token":"[redacted]"');
}

interface PlatformContext {
  environment: ProviderEnvironment;
  clientId: string;
  clientSecret: string;
  webhookId: string | null;
  partnerAttributionId: string | null;
  partnerMerchantId: string | null;
}

/** Loads and decrypts Himplant's PayPal platform credentials for an environment. */
export async function loadPaypalPlatform(
  environment: ProviderEnvironment,
): Promise<PlatformContext> {
  const db = serviceClient();
  const config = await getPlatformConfig(db, "paypal", environment);
  if (!config) throw new Error("PayPal platform configuration is missing");
  const creds = await loadPlatformCredentials(db, config.id);
  const clientId = String(creds?.client_id ?? "");
  const clientSecret = String(creds?.client_secret ?? "");
  if (!clientId || !clientSecret) throw new Error("PayPal platform credentials are incomplete");
  return {
    environment,
    clientId,
    clientSecret,
    webhookId: creds?.webhook_id ? String(creds.webhook_id) : null,
    partnerAttributionId: creds?.partner_attribution_id
      ? String(creds.partner_attribution_id)
      : null,
    partnerMerchantId: creds?.partner_merchant_id ? String(creds.partner_merchant_id) : null,
  };
}

export async function paypalAccessToken(ctx: PlatformContext): Promise<string> {
  const res = await fetch(`${paypalApiBase(ctx.environment)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${ctx.clientId}:${ctx.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PayPal token request failed [${res.status}]`);
  const body = JSON.parse(text) as { access_token?: string };
  if (!body.access_token) throw new Error("PayPal did not return an access token");
  return body.access_token;
}

async function ppFetch(
  ctx: PlatformContext,
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Record<string, unknown>> {
  const { token, headers, ...rest } = init;
  const accessToken = token ?? (await paypalAccessToken(ctx));
  const res = await fetch(`${paypalApiBase(ctx.environment)}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(ctx.partnerAttributionId
        ? { "PayPal-Partner-Attribution-Id": ctx.partnerAttributionId }
        : {}),
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
    throw new Error(`PayPal ${path} failed [${res.status}]: ${scrub(text).slice(0, 500)}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Partner onboarding (merchant self-connection)
// ---------------------------------------------------------------------------

/**
 * Creates a PayPal partner referral and returns the action URL the surgeon
 * must open to grant Himplant permission to create orders payable to them.
 * `trackingId` is the surgeon's provider_accounts.id, echoed back to us in the
 * onboarding webhook/status poll.
 */
export async function paypalCreatePartnerReferral(params: {
  environment: ProviderEnvironment;
  trackingId: string;
  returnUrl: string;
  email?: string | null;
  country?: string | null;
}): Promise<{ actionUrl: string; referralId: string | null }> {
  const ctx = await loadPaypalPlatform(params.environment);
  const body = {
    tracking_id: params.trackingId,
    partner_config_override: { return_url: params.returnUrl },
    operations: [
      {
        operation: "API_INTEGRATION",
        api_integration_preference: {
          rest_api_integration: {
            integration_method: "PAYPAL",
            integration_type: "THIRD_PARTY",
            third_party_details: {
              features: ["PAYMENT", "REFUND", "PARTNER_FEE", "ACCESS_MERCHANT_INFORMATION"],
            },
          },
        },
      },
    ],
    products: ["EXPRESS_CHECKOUT"],
    legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
    ...(params.email ? { email: params.email } : {}),
  };

  const referral = await ppFetch(ctx, "/v2/customer/partner-referrals", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const links = (referral.links as { rel?: string; href?: string }[] | undefined) ?? [];
  const action = links.find((l) => l.rel === "action_url")?.href;
  if (!action) throw new Error("PayPal did not return an onboarding URL");
  return { actionUrl: action, referralId: (referral.partner_referral_id as string) ?? null };
}

/** Reads merchant onboarding status by tracking id (our provider_accounts.id). */
export async function paypalMerchantStatus(params: {
  environment: ProviderEnvironment;
  trackingId: string;
}): Promise<{
  merchantId: string | null;
  paymentsReceivable: boolean;
  emailConfirmed: boolean;
  raw: Record<string, unknown>;
}> {
  const ctx = await loadPaypalPlatform(params.environment);
  if (!ctx.partnerMerchantId) {
    throw new Error("PayPal partner merchant id is not configured");
  }
  const data = await ppFetch(
    ctx,
    `/v1/customer/partners/${encodeURIComponent(ctx.partnerMerchantId)}/merchant-integrations?tracking_id=${encodeURIComponent(params.trackingId)}`,
  );
  return {
    merchantId: (data.merchant_id as string | undefined) ?? null,
    paymentsReceivable: data.payments_receivable === true,
    emailConfirmed: data.primary_email_confirmed === true,
    raw: data,
  };
}

// ---------------------------------------------------------------------------
// Webhook signature verification (official PayPal verification endpoint)
// ---------------------------------------------------------------------------

export async function verifyPaypalWebhook(params: {
  environment: ProviderEnvironment;
  headers: Headers;
  rawBody: string;
}): Promise<{ ok: boolean; reason?: string; event?: Record<string, unknown> }> {
  const ctx = await loadPaypalPlatform(params.environment);
  if (!ctx.webhookId) return { ok: false, reason: "webhook id not configured" };

  const h = (name: string) => params.headers.get(name) ?? params.headers.get(name.toLowerCase());
  const transmissionId = h("paypal-transmission-id");
  const transmissionTime = h("paypal-transmission-time");
  const transmissionSig = h("paypal-transmission-sig");
  const certUrl = h("paypal-cert-url");
  const authAlgo = h("paypal-auth-algo");

  if (!transmissionId || !transmissionSig || !certUrl || !transmissionTime) {
    return { ok: false, reason: "missing PayPal signature headers" };
  }
  // PayPal serves verification certs only from its own domain.
  try {
    const host = new URL(certUrl).hostname;
    if (!/(^|\.)paypal\.com$/.test(host)) return { ok: false, reason: "untrusted cert url" };
  } catch {
    return { ok: false, reason: "invalid cert url" };
  }

  let event: Record<string, unknown>;
  try {
    event = params.rawBody ? JSON.parse(params.rawBody) : {};
  } catch {
    return { ok: false, reason: "invalid json" };
  }

  const result = await ppFetch(ctx, "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      cert_url: certUrl,
      auth_algo: authAlgo,
      transmission_sig: transmissionSig,
      webhook_id: ctx.webhookId,
      webhook_event: event,
    }),
  });

  if (result.verification_status !== "SUCCESS") {
    return { ok: false, reason: "signature verification failed", event };
  }
  return { ok: true, event };
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

export function normalizePaypalStatus(providerStatus: string): IntlPaymentStatus {
  const s = (providerStatus || "").toUpperCase();
  const map: Record<string, IntlPaymentStatus> = {
    CREATED: "processing",
    SAVED: "processing",
    APPROVED: "processing",
    PAYER_ACTION_REQUIRED: "processing",
    PENDING: "processing",
    COMPLETED: "approved",
    CAPTURED: "approved",
    DECLINED: "failed",
    FAILED: "failed",
    VOIDED: "canceled",
    CANCELLED: "canceled",
    EXPIRED: "expired",
    REFUNDED: "refunded",
    PARTIALLY_REFUNDED: "refunded",
    REVERSED: "disputed",
  };
  return map[s] ?? "processing";
}

function amountToMinor(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Pulls the most meaningful status out of an Orders v2 payload. */
export function paypalOrderStatus(order: Record<string, unknown>): string {
  const units = (order.purchase_units as Record<string, unknown>[] | undefined) ?? [];
  const captures =
    (units[0]?.payments as { captures?: Record<string, unknown>[] } | undefined)?.captures ?? [];
  if (captures.length > 0) return String(captures[0].status ?? order.status ?? "");
  return String(order.status ?? "");
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

async function resolvePaypalAccount(providerAccountId: string) {
  const db = serviceClient();
  const { data: account } = await db
    .from("provider_accounts")
    .select("id, environment, external_merchant_id, status, is_active, currency")
    .eq("id", providerAccountId)
    .maybeSingle();
  if (!account) throw new Error("PayPal account not found");
  if (!account.is_active || account.status !== "connected") {
    throw new Error("This PayPal account is not connected");
  }
  if (!account.external_merchant_id) {
    throw new Error("PayPal merchant onboarding is not complete for this surgeon");
  }
  return {
    merchantId: String(account.external_merchant_id),
    environment: normalizeEnvironment(account.environment),
  };
}

export const paypalProvider: PaymentProvider = {
  name: "paypal",

  // Onboarding runs through the dedicated provider-connect-* edge functions,
  // which own one-time state. These interface methods refuse to duplicate it.
  startMerchantConnection(): Promise<{ url: string; state: string }> {
    return Promise.reject(new NotSupportedError("Direct startMerchantConnection"));
  },
  completeMerchantConnection(): Promise<
    { externalMerchantId: string; capabilities: Record<string, unknown> }
  > {
    return Promise.reject(new NotSupportedError("Direct completeMerchantConnection"));
  },

  async getMerchantStatus(externalMerchantId: string) {
    return {
      status: externalMerchantId ? ("connected" as const) : ("pending" as const),
      capabilities: { orders_v2: true, payee_merchant_id: true },
    };
  },

  async disconnectMerchant() {
    /* The merchant revokes Himplant's permissions from their own PayPal account. */
  },

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (!req.providerAccountId) throw new Error("PayPal requires a connected surgeon account");
    const account = await resolvePaypalAccount(req.providerAccountId);
    const ctx = await loadPaypalPlatform(account.environment);

    const order = await ppFetch(ctx, "/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": req.consultationId },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            // Immutable consultation id — the only join key we trust back.
            custom_id: req.consultationId,
            invoice_id: req.consultationId,
            description: req.description.slice(0, 127),
            amount: {
              currency_code: req.currency,
              value: (req.amountMinor / 100).toFixed(2),
            },
            // Money settles directly into the surgeon's merchant account.
            payee: { merchant_id: account.merchantId },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: "PAY_NOW",
              return_url: req.successUrl,
              cancel_url: req.failureUrl,
            },
          },
        },
      }),
    });

    const links = (order.links as { rel?: string; href?: string }[] | undefined) ?? [];
    const approve = links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    if (!approve) throw new Error("PayPal did not return an approval URL");

    return {
      checkoutUrl: approve,
      providerOrderId: (order.id as string | undefined) ?? null,
      providerPaymentId: null,
    };
  },

  async getPayment(lookupId: string, ctx?: ProviderCallContext): Promise<NormalizedPayment> {
    const environment = ctx?.providerAccountId
      ? (await resolvePaypalAccount(ctx.providerAccountId)).environment
      : normalizeEnvironment("sandbox");
    const platform = await loadPaypalPlatform(environment);
    const order = await ppFetch(platform, `/v2/checkout/orders/${encodeURIComponent(lookupId)}`);

    const units = (order.purchase_units as Record<string, unknown>[] | undefined) ?? [];
    const unit = units[0] ?? {};
    const capture =
      ((unit.payments as { captures?: Record<string, unknown>[] } | undefined)?.captures ?? [])[0] ??
        null;
    const amount = (capture?.amount ?? unit.amount) as
      | { currency_code?: string; value?: string }
      | undefined;
    const payee = unit.payee as { merchant_id?: string } | undefined;

    return {
      providerPaymentId: capture?.id != null ? String(capture.id) : null,
      providerOrderId: order.id != null ? String(order.id) : null,
      status: normalizePaypalStatus(paypalOrderStatus(order)),
      amountMinor: amountToMinor(amount?.value),
      currency: amount?.currency_code ?? null,
      recipientMerchantId: payee?.merchant_id ?? null,
      externalReference: (unit.custom_id as string | undefined) ??
        (unit.invoice_id as string | undefined) ?? null,
      raw: {
        id: order.id,
        status: order.status,
        capture_status: capture?.status ?? null,
        amount,
        custom_id: unit.custom_id ?? null,
        payee_merchant_id: payee?.merchant_id ?? null,
      },
    };
  },

  async verifyWebhook(req: Request, rawBody: string): Promise<WebhookVerification> {
    const url = new URL(req.url);
    const environment = normalizeEnvironment(url.searchParams.get("environment") ?? "sandbox");

    const verified = await verifyPaypalWebhook({ environment, headers: req.headers, rawBody });
    if (!verified.ok) {
      return { ok: false, eventId: null, lookupId: null, reason: verified.reason };
    }

    const event = verified.event ?? {};
    const resource = (event.resource as Record<string, unknown> | undefined) ?? {};
    // Capture events carry the order id in supplementary_data / links.
    const orderId =
      ((resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined)
        ?.related_ids?.order_id) ??
        (typeof resource.id === "string" && String(event.resource_type) === "checkout-order"
          ? (resource.id as string)
          : null);

    return {
      ok: true,
      eventId: (event.id as string | undefined) ?? null,
      lookupId: orderId ?? (resource.id != null ? String(resource.id) : null),
    };
  },

  normalizePaymentStatus(providerStatus: string): IntlPaymentStatus {
    return normalizePaypalStatus(providerStatus);
  },

  getAvailablePaymentMethods(): string[] {
    return ["paypal", "card"];
  },

  refundPayment(): Promise<never> {
    return Promise.reject(
      new NotSupportedError("Refunds for the international consultation fee"),
    );
  },
};
