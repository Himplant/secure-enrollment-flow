/**
 * INTERNATIONAL Mercado Pago webhook routing/environment safety.
 *
 * Covers only the international rail (`intl-payment-webhook`). No U.S.
 * enrollment/Stripe module is imported or exercised here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const ENV: Record<string, string | undefined> = {
  PROVIDER_CREDENTIALS_KEY: "unit-test-provider-credentials-key-0123456789",
  SUPABASE_URL: "https://aygfraqvempqexlplofu.supabase.co",
};

const g = globalThis as unknown as { Deno?: { env: { get: (n: string) => string | undefined } } };
beforeAll(() => {
  g.Deno = { env: { get: (name: string) => ENV[name] } };
});

const getPlatformConfig = vi.fn();
const loadPlatformCredentials = vi.fn();

vi.mock("../../supabase/functions/_shared/provider-config.ts", () => ({
  getPlatformConfig: (...a: unknown[]) => getPlatformConfig(...a),
  loadAccountCredentials: vi.fn(),
  loadPlatformCredentials: (...a: unknown[]) => loadPlatformCredentials(...a),
  normalizeEnvironment: (v: unknown) => (v === "live" ? "live" : "sandbox"),
  saveAccountCredentials: vi.fn(),
  serviceClient: () => ({}),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
const MP_PATH = "../../supabase/functions/_shared/providers/mercado-pago.ts";
const CRYPTO_PATH = "../../supabase/functions/_shared/provider-crypto.ts";
const mp: any = await import(/* @vite-ignore */ MP_PATH);
const crypto_: any = await import(/* @vite-ignore */ CRYPTO_PATH);

const LIVE_SECRET = "whsec-live-production";
const SANDBOX_SECRET = "whsec-sandbox-test";

function configureSecrets() {
  getPlatformConfig.mockReset();
  loadPlatformCredentials.mockReset();
  getPlatformConfig.mockImplementation((_db: unknown, _p: string, env: string) => ({ id: `cfg-${env}` }));
  loadPlatformCredentials.mockImplementation((_db: unknown, id: string) => ({
    webhook_secret: id === "cfg-live" ? LIVE_SECRET : SANDBOX_SECRET,
  }));
}

async function signedRequest(opts: { url: string; secret: string; dataId: string; requestId: string }) {
  const ts = String(Math.floor(Date.now() / 1000));
  const v1 = await crypto_.hmacSha256Hex(
    opts.secret,
    `id:${opts.dataId};request-id:${opts.requestId};ts:${ts};`,
  );
  const body = JSON.stringify({ id: 99, data: { id: opts.dataId } });
  return {
    req: new Request(opts.url, {
      method: "POST",
      headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": opts.requestId },
      body,
    }),
    body,
  };
}

const BASE = "https://aygfraqvempqexlplofu.supabase.co/functions/v1/intl-payment-webhook";

describe("mercado pago notification_url routing hints", () => {
  it("adds provider, environment and provider_account_id over https", () => {
    const url = mp.mercadoPagoNotificationUrl({
      baseUrl: "https://aygfraqvempqexlplofu.supabase.co",
      environment: "live",
      providerAccountId: "acc-live-1",
    });
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.pathname).toBe("/functions/v1/intl-payment-webhook");
    expect(parsed.searchParams.get("provider")).toBe("mercado_pago");
    expect(parsed.searchParams.get("environment")).toBe("live");
    expect(parsed.searchParams.get("provider_account_id")).toBe("acc-live-1");
  });

  it("keeps the admin-facing base webhook URL valid and unchanged", () => {
    const admin = `${BASE}?provider=mercado_pago`;
    expect(admin).toBe(
      "https://aygfraqvempqexlplofu.supabase.co/functions/v1/intl-payment-webhook?provider=mercado_pago",
    );
    // Legacy URL without the environment param still resolves both configs.
    expect(mp.mercadoPagoWebhookEnvironments(null)).toEqual(["live", "sandbox"]);
  });

  it("pins exactly one environment when the param is explicit", () => {
    expect(mp.mercadoPagoWebhookEnvironments("live")).toEqual(["live"]);
    expect(mp.mercadoPagoWebhookEnvironments("sandbox")).toEqual(["sandbox"]);
  });
});

describe("mercado pago webhook environment selection", () => {
  it("verifies a live event with the LIVE platform secret", async () => {
    configureSecrets();
    const { req, body } = await signedRequest({
      url: `${BASE}?provider=mercado_pago&environment=live&provider_account_id=acc-live-1`,
      secret: LIVE_SECRET,
      dataId: "111",
      requestId: "req-live",
    });
    const result = await mp.mercadoPagoProvider.verifyWebhook(req, body);
    expect(result.ok).toBe(true);
    expect(result.lookupId).toBe("111");
    expect(getPlatformConfig).toHaveBeenCalledWith(expect.anything(), "mercado_pago", "live");
    expect(getPlatformConfig).not.toHaveBeenCalledWith(expect.anything(), "mercado_pago", "sandbox");
  });

  it("never accepts a live-signed event against the sandbox secret", async () => {
    configureSecrets();
    const { req, body } = await signedRequest({
      url: `${BASE}?provider=mercado_pago&environment=sandbox`,
      secret: LIVE_SECRET,
      dataId: "222",
      requestId: "req-x",
    });
    const result = await mp.mercadoPagoProvider.verifyWebhook(req, body);
    expect(result.ok).toBe(false);
  });

  it("verifies a sandbox event with the SANDBOX platform secret", async () => {
    configureSecrets();
    const { req, body } = await signedRequest({
      url: `${BASE}?provider=mercado_pago&environment=sandbox&provider_account_id=acc-sbx-1`,
      secret: SANDBOX_SECRET,
      dataId: "333",
      requestId: "req-sbx",
    });
    const result = await mp.mercadoPagoProvider.verifyWebhook(req, body);
    expect(result.ok).toBe(true);
    expect(getPlatformConfig).toHaveBeenCalledWith(expect.anything(), "mercado_pago", "sandbox");
    expect(getPlatformConfig).not.toHaveBeenCalledWith(expect.anything(), "mercado_pago", "live");
  });

  it("legacy URLs without an environment param still verify a live event", async () => {
    configureSecrets();
    const { req, body } = await signedRequest({
      url: `${BASE}?provider=mercado_pago`,
      secret: LIVE_SECRET,
      dataId: "444",
      requestId: "req-legacy",
    });
    const result = await mp.mercadoPagoProvider.verifyWebhook(req, body);
    expect(result.ok).toBe(true);
  });
});

describe("intl-payment-webhook seller routing", () => {
  const source = readFileSync(
    resolve(process.cwd(), "supabase/functions/intl-payment-webhook/index.ts"),
    "utf8",
  );

  it("uses provider_account_id only for mercado_pago and validates the row", () => {
    expect(source).toContain('providerName === "mercado_pago"');
    expect(source).toContain('url.searchParams.get("provider_account_id")');
    expect(source).toContain('.eq("provider", "mercado_pago")');
  });

  it("keeps the consultation and single-account fallbacks for other providers", () => {
    expect(source).toContain("if (!providerAccountId && hintedConsultationId)");
    expect(source).toContain('if (!providerAccountId && providerName !== "test")');
  });

  it("still re-fetches the payment and gates approval on authoritative checks", () => {
    expect(source).toContain("await provider.getPayment(verification.lookupId, { providerAccountId })");
    expect(source).toContain('mismatches.push("provider")');
    expect(source).toContain('mismatches.push("amount")');
    expect(source).toContain('mismatches.push("currency")');
    expect(source).toContain('mismatches.push("recipient")');
    expect(source).toContain("const consultationId = payment.externalReference");
    // A tampered hint cannot approve anything: mismatch short-circuits before
    // the consultation row is ever updated.
    const mismatchIdx = source.indexOf("if (mismatches.length > 0)");
    const updateIdx = source.indexOf('await admin.from("consultations").update(update)');
    expect(mismatchIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(mismatchIdx);
  });
});
