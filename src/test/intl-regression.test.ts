import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * These guard the U.S. enrollment flow against regressions from international work.
 * They assert the shape of the production code paths, not runtime behavior against
 * the live database (which must never be touched by tests).
 */
describe("U.S. enrollment flow remains intact", () => {
  const usFunctions = [
    "supabase/functions/create-enrollment/index.ts",
    "supabase/functions/get-enrollment/index.ts",
    "supabase/functions/create-checkout-session/index.ts",
    "supabase/functions/stripe-webhook/index.ts",
    "supabase/functions/sync-credits/index.ts",
    "supabase/functions/sync-surgeons/index.ts",
    "supabase/functions/mark-refunded/index.ts",
  ];

  it.each(usFunctions)("%s still exists", (path) => {
    expect(existsSync(path)).toBe(true);
  });

  it("create-enrollment still writes to the enrollments table", () => {
    const src = read("supabase/functions/create-enrollment/index.ts");
    expect(src).toContain('from("enrollments")');
    expect(src).toContain("ENROLLMENT_SHARED_SECRET");
  });

  it("create-enrollment does not depend on international modules", () => {
    const src = read("supabase/functions/create-enrollment/index.ts");
    expect(src).not.toMatch(/intl-(policy|consultation-service|send-link|link-secret)/);
    expect(src).not.toContain('from("consultations")');
  });

  it("stripe-webhook only touches U.S. tables", () => {
    const src = read("supabase/functions/stripe-webhook/index.ts");
    expect(src).toContain('from("enrollments")');
    expect(src).not.toContain('from("consultations")');
    expect(src).not.toContain("consultation_payment_attempts");
  });

  it("US checkout session still uses Stripe", () => {
    const src = read("supabase/functions/create-checkout-session/index.ts");
    expect(src).toContain("STRIPE_SECRET_KEY");
    expect(src).not.toContain("mercado_pago");
  });

  it("admin auth + MFA enforcement is unchanged for US admin functions", () => {
    const src = read("supabase/functions/_shared/admin-auth.ts");
    expect(src).toContain("jwtHasAal2");
    expect(src).toContain("requireAdmin");
  });

  it("the public enroll route is still registered", () => {
    const app = read("src/App.tsx");
    expect(app).toContain("/enroll/:token");
  });

  it("international routes never shadow the U.S. enroll route", () => {
    const app = read("src/App.tsx");
    const enrollIdx = app.indexOf("/enroll/:token");
    expect(enrollIdx).toBeGreaterThan(-1);
    expect(app).not.toContain('path="/enroll/:token" element={<IntlConsultation');
  });
});

describe("international module is isolated behind flags", () => {
  it("intl edge functions gate on the feature flag", () => {
    for (const fn of [
      "supabase/functions/intl-create-consultation/index.ts",
      "supabase/functions/intl-create-payment/index.ts",
      "supabase/functions/intl-portal-resend-link/index.ts",
    ]) {
      expect(read(fn)).toContain("requireIntlEnabled");
    }
  });

  it("checkout is blocked without an immutable policy snapshot", () => {
    const src = read("supabase/functions/intl-create-payment/index.ts");
    expect(src).toContain("requirePolicySnapshot");
  });

  it("payment attempts are appended, never overwritten", () => {
    const src = read("supabase/functions/intl-create-payment/index.ts");
    expect(src).toContain('from("consultation_payment_attempts")');
    expect(src).toContain(".insert(");
  });

  it("webhook processing is retryable and not permanently deduplicated", () => {
    const src = read("supabase/functions/intl-payment-webhook/index.ts");
    expect(src).toContain("retryable_error");
    expect(src).toContain("TERMINAL");
  });

  it("distributor roles cannot write consultation progress", () => {
    const src = read("supabase/functions/intl-portal-update-consultation/index.ts");
    expect(src).toContain('const WRITE_ROLES = ["surgeon_admin", "surgeon_staff"]');
    expect(src).not.toContain("distributor_admin");
  });

  it("reminders reuse the active link and regeneration is explicit", () => {
    const src = read("supabase/functions/intl-portal-resend-link/index.ts");
    expect(src).toContain("send_reminder");
    expect(src).toContain("confirm_invalidate");
  });

  it("raw link tokens are only stored through the encrypted secret helper", () => {
    const service = read("supabase/functions/_shared/intl-consultation-service.ts");
    expect(service).toContain("storeLinkToken");
    expect(service).toContain("token_hash");
  });
});
