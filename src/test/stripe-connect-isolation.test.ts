import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

const ADAPTER = "supabase/functions/_shared/providers/stripe-connect.ts";
const REGISTRY = "supabase/functions/_shared/providers/registry.ts";

/**
 * The international Stripe Connect rail must never touch the U.S. SecurePay
 * Stripe flow. These are structural guarantees, not stylistic preferences.
 */
describe("stripe connect isolation from the U.S. flow", () => {
  const adapter = read(ADAPTER);

  it("never reads the U.S. Stripe secrets", () => {
    expect(adapter).not.toContain("STRIPE_SECRET_KEY");
    expect(adapter).not.toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("never imports U.S. enrollment code", () => {
    expect(adapter).not.toMatch(/from ".*(stripe-webhook|create-checkout-session|enrollment)/);
  });

  it("creates checkout on the surgeon's connected account (direct charges)", () => {
    expect(adapter).toContain("stripeAccount: account.accountId");
  });

  it("refuses a key that does not match the environment", () => {
    expect(adapter).toContain("does not match the");
  });

  it("declines refunds for the consultation fee", () => {
    expect(adapter).toContain("NotSupportedError");
  });

  it("is registered in the international provider registry", () => {
    expect(read(REGISTRY)).toContain("stripe_connect: stripeConnectProvider");
  });

  it("leaves the U.S. Stripe webhook free of international provider imports", () => {
    const usWebhook = read("supabase/functions/stripe-webhook/index.ts");
    expect(usWebhook).not.toContain("stripe-connect");
    expect(usWebhook).not.toContain("providers/registry");
  });
});
