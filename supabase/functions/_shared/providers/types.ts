// Payment provider adapter contract for the International Consultations module.
//
// Every international provider (Mercado Pago, PayPal, the simulated test
// provider) implements this interface. Nothing here is shared with the U.S.
// Stripe enrollment flow — that path stays frozen.

export type IntlPaymentStatus =
  | "draft"
  | "link_created"
  | "link_sent"
  | "link_opened"
  | "processing"
  | "approved"
  | "failed"
  | "expired"
  | "canceled"
  | "refunded"
  | "disputed";

export interface CheckoutRequest {
  consultationId: string;
  /** Merchant that money settles to — the clinic/surgeon, never Himplant. */
  recipientMerchantId: string | null;
  amountMinor: number;
  currency: string;
  country: string;
  description: string;
  payerEmail?: string | null;
  payerName?: string | null;
  successUrl: string;
  pendingUrl: string;
  failureUrl: string;
  environment: "sandbox" | "live";
}

export interface CheckoutResult {
  checkoutUrl: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
}

export interface NormalizedPayment {
  providerPaymentId: string | null;
  providerOrderId: string | null;
  status: IntlPaymentStatus;
  amountMinor: number | null;
  currency: string | null;
  recipientMerchantId: string | null;
  externalReference: string | null;
  raw: unknown;
}

export interface WebhookVerification {
  ok: boolean;
  /** Provider-side event id used for idempotency. */
  eventId: string | null;
  /** Identifier the adapter needs to re-fetch the authoritative payment. */
  lookupId: string | null;
  reason?: string;
}

export class NotSupportedError extends Error {
  constructor(what: string) {
    super(`${what} is not supported by this provider`);
    this.name = "NotSupportedError";
  }
}

export interface PaymentProvider {
  readonly name: string;

  /** Merchant connection lifecycle. */
  startMerchantConnection(params: {
    clinicId: string;
    country: string;
    redirectUri: string;
  }): Promise<{ url: string; state: string }>;
  completeMerchantConnection(params: {
    code: string;
    state: string;
  }): Promise<{ externalMerchantId: string; capabilities: Record<string, unknown> }>;
  getMerchantStatus(externalMerchantId: string): Promise<{
    status: "connected" | "pending" | "expired" | "revoked" | "disabled";
    capabilities: Record<string, unknown>;
  }>;
  disconnectMerchant(externalMerchantId: string): Promise<void>;

  /** Payment lifecycle. */
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  getPayment(lookupId: string): Promise<NormalizedPayment>;
  verifyWebhook(req: Request, rawBody: string): Promise<WebhookVerification>;
  normalizePaymentStatus(providerStatus: string): IntlPaymentStatus;
  getAvailablePaymentMethods(country: string): string[];

  /**
   * The consultation fee is non-refundable by policy. Adapters declare this
   * method but must throw NotSupportedError until refunds are explicitly
   * approved for the international programme.
   */
  refundPayment(providerPaymentId: string): Promise<never>;
}
