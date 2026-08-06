// Simulated payment provider.
//
// Lets the entire international flow be exercised end-to-end — invitation,
// checkout, webhook, reconciliation — with no real money and no external
// dependency. Only usable when the `test_provider_enabled` flag is on.
import {
  type CheckoutRequest,
  type CheckoutResult,
  type IntlPaymentStatus,
  type NormalizedPayment,
  NotSupportedError,
  type PaymentProvider,
  type WebhookVerification,
} from "./types.ts";

/** In-memory is not durable across isolates, so state is derived from the id. */
function decodeIntent(id: string): { consultationId: string; amountMinor: number; currency: string } | null {
  try {
    const json = atob(id.replace(/^test_/, "").replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function encodeIntent(payload: Record<string, unknown>): string {
  return "test_" + btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const testProvider: PaymentProvider = {
  name: "test",

  async startMerchantConnection({ clinicId, redirectUri }) {
    const state = crypto.randomUUID();
    const url = `${redirectUri}?provider=test&state=${state}&code=test_code_${clinicId}`;
    return { url, state };
  },

  async completeMerchantConnection({ code }) {
    return {
      externalMerchantId: `test_merchant_${code.slice(-8)}`,
      capabilities: { checkout: true, simulated: true },
    };
  },

  async getMerchantStatus(externalMerchantId) {
    return {
      status: externalMerchantId ? "connected" : "pending",
      capabilities: { checkout: true, simulated: true },
    };
  },

  async disconnectMerchant() {
    /* nothing to revoke for the simulator */
  },

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const providerPaymentId = encodeIntent({
      consultationId: req.consultationId,
      amountMinor: req.amountMinor,
      currency: req.currency,
      recipientMerchantId: req.recipientMerchantId,
    });
    const url = new URL(req.pendingUrl);
    url.searchParams.set("simulate", "1");
    url.searchParams.set("payment_id", providerPaymentId);
    return {
      checkoutUrl: url.toString(),
      providerOrderId: providerPaymentId,
      providerPaymentId,
    };
  },

  async getPayment(lookupId: string): Promise<NormalizedPayment> {
    const intent = decodeIntent(lookupId);
    return {
      providerPaymentId: lookupId,
      providerOrderId: lookupId,
      status: "approved",
      amountMinor: intent?.amountMinor ?? null,
      currency: intent?.currency ?? null,
      recipientMerchantId: (intent as { recipientMerchantId?: string } | null)?.recipientMerchantId ?? null,
      externalReference: intent?.consultationId ?? null,
      raw: { simulated: true, lookupId },
    };
  },

  async verifyWebhook(req: Request, rawBody: string): Promise<WebhookVerification> {
    const secret = Deno.env.get("CRON_SECRET");
    const provided = req.headers.get("x-test-provider-secret");
    if (!secret || provided !== secret) {
      return { ok: false, eventId: null, lookupId: null, reason: "bad signature" };
    }
    try {
      const body = JSON.parse(rawBody) as { event_id?: string; payment_id?: string };
      return {
        ok: true,
        eventId: body.event_id ?? crypto.randomUUID(),
        lookupId: body.payment_id ?? null,
      };
    } catch {
      return { ok: false, eventId: null, lookupId: null, reason: "invalid json" };
    }
  },

  normalizePaymentStatus(providerStatus: string): IntlPaymentStatus {
    const map: Record<string, IntlPaymentStatus> = {
      pending: "processing",
      in_process: "processing",
      approved: "approved",
      rejected: "failed",
      cancelled: "canceled",
      canceled: "canceled",
      expired: "expired",
      refunded: "refunded",
      charged_back: "disputed",
    };
    return map[providerStatus] ?? "processing";
  },

  getAvailablePaymentMethods() {
    return ["simulated_card"];
  },

  async refundPayment(): Promise<never> {
    throw new NotSupportedError("Refund");
  },
};
