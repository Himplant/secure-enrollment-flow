import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  flowForCountry,
  isInternationalCountry,
  normalizeError,
  normalizeResponse,
  sanitizeIntlPayload,
} from "../../supabase/functions/_shared/zoho-route";

const ROUTER = readFileSync("supabase/functions/zoho-generate-enrollment-link/index.ts", "utf8");

describe("Zoho single-button routing", () => {
  it("routes MX/CO/CL to the international flow", () => {
    for (const c of ["MX", "CO", "CL", "co", " cl "]) {
      expect(isInternationalCountry(c)).toBe(true);
      expect(flowForCountry(c)).toBe("international");
    }
  });

  it("routes every other country (domestic) to the U.S. flow", () => {
    for (const c of ["US", "United States", null, undefined, "", "CA"]) {
      expect(isInternationalCountry(c)).toBe(false);
      expect(flowForCountry(c)).toBe("domestic");
    }
  });

  it("strips legacy USD currency and expiry overrides from international payloads", () => {
    const out = sanitizeIntlPayload({
      patient_name: "A",
      currency: "usd",
      expires_in_hours: 72,
      amount: 500,
    });
    expect(out).not.toHaveProperty("currency");
    expect(out).not.toHaveProperty("expires_in_hours");
    expect(out.amount).toBe(500);
  });

  it("forwards the domestic payload unchanged", () => {
    expect(ROUTER).toContain('targetPath = "create-enrollment"');
    expect(ROUTER).toContain("outboundBody = { ...body };");
  });

  it("normalizes the international response onto enrollment_url", () => {
    const n = normalizeResponse("international", "CO", {
      success: true,
      consultation_id: "c1",
      consultation_url: "https://x/pay/abc",
      expires_at: "2026-01-01T00:00:00Z",
      currency: "COP",
      provider: "mercado_pago",
    });
    expect(n).toMatchObject({
      success: true,
      enrollment_url: "https://x/pay/abc",
      expires_at: "2026-01-01T00:00:00Z",
      flow_type: "international",
      surgeon_country: "CO",
      consultation_id: "c1",
      currency: "COP",
      provider: "mercado_pago",
    });
    expect(n).not.toHaveProperty("enrollment_id");
  });

  it("normalizes the domestic response", () => {
    const n = normalizeResponse("domestic", "US", {
      success: true,
      enrollment_id: "e1",
      enrollment_url: "https://x/enroll/abc",
      expires_at: "2026-01-01T00:00:00Z",
    });
    expect(n.enrollment_url).toBe("https://x/enroll/abc");
    expect(n.flow_type).toBe("domestic");
    expect(n.enrollment_id).toBe("e1");
  });

  it("returns errors without patient PII", () => {
    const e = normalizeError("international", "CO", { error: "no live account", patient_email: "a@b.c" }, "fallback");
    expect(e).toEqual({ success: false, error: "no live account", flow_type: "international", surgeon_country: "CO" });
  });
});

describe("Zoho router edge function", () => {
  it("refreshes the surgeon from Zoho before routing", () => {
    const refreshIdx = ROUTER.indexOf("fetchAndUpsertSurgeonFromZoho(admin");
    const routeIdx = ROUTER.indexOf("flowForCountry(surgeonCountry)");
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(routeIdx).toBeGreaterThan(refreshIdx);
  });

  it("fails closed when the surgeon cannot be refreshed or is inactive", () => {
    expect(ROUTER).toContain("Surgeon could not be refreshed from Zoho");
    expect(ROUTER).toContain("Surgeon is inactive");
    expect(ROUTER).toContain("Surgeon could not be identified for routing");
  });

  it("never routes on surgeon name", () => {
    expect(ROUTER).not.toContain("surgeon_name");
  });

  it("sanitizes only the international outbound payload", () => {
    expect(ROUTER).toContain("sanitizeIntlPayload({ ...body");
  });

  it("does not log or return secrets", () => {
    expect(ROUTER).not.toMatch(/console\.(log|error|warn)\([^)]*(Secret|SECRET|secret)/);
  });

  it("leaves the protected U.S. create-enrollment function unchanged", () => {
    const us = readFileSync("supabase/functions/create-enrollment/index.ts", "utf8");
    const hash = require("node:crypto").createHash("sha256").update(us).digest("hex");
    expect(hash).toBe("550ab9270f23feebeed84e650b28572092e431d216c1cd2a470bb2c69464abef");
  });
});
