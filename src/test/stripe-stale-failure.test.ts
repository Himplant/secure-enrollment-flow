import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { isStaleFailure } from "../../supabase/functions/_shared/enrollment-guards";

describe("late payment-failed notices never downgrade a paid enrollment", () => {
  it("ignores a failure when the enrollment is already paid", () => {
    expect(isStaleFailure("paid", "pi_new", "pi_old")).toBe(true);
    expect(isStaleFailure("paid", "pi_same", "pi_same")).toBe(true);
  });
  it("ignores a failure when refunded", () => {
    expect(isStaleFailure("refunded", null, "pi_x")).toBe(true);
  });
  it("ignores a failure from a superseded attempt", () => {
    expect(isStaleFailure("processing", "pi_new", "pi_old")).toBe(true);
  });
  it("applies a failure for the current attempt", () => {
    expect(isStaleFailure("processing", "pi_cur", "pi_cur")).toBe(false);
    expect(isStaleFailure("opened", null, "pi_cur")).toBe(false);
  });
  it("webhook uses the guard and conditional updates", () => {
    const src = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
    expect(src).toMatch(/isStaleFailure\(/);
    expect(src).toMatch(/\.not\("status", "in", "\(paid,refunded\)"\)/);
    expect(src).toMatch(/\.eq\("stripe_session_id", session\.id\)/);
  });
});
