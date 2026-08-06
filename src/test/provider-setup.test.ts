/**
 * Provider setup unit tests.
 *
 * These exercise the pure server helpers (crypto, masking, completeness,
 * status normalization, webhook HMAC, OAuth state, response serialization).
 * The Deno globals and the deno-only imports inside the adapter are shimmed so
 * the same source files that ship to the edge runtime are the ones tested.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const KEY = "unit-test-provider-credentials-key-0123456789";

const ENV: Record<string, string | undefined> = {
  PROVIDER_CREDENTIALS_KEY: KEY,
  SUPABASE_URL: "https://example.supabase.co",
  APP_URL: "https://app.example.com",
};

const g = globalThis as unknown as { Deno?: { env: { get: (n: string) => string | undefined } } };

beforeAll(() => {
  g.Deno = { env: { get: (name: string) => ENV[name] } };
});

// The adapter imports provider-config.ts, which pulls the Deno-only supabase
// ESM URL. Mocking it keeps that module from ever being resolved.
vi.mock("../../supabase/functions/_shared/provider-config.ts", () => ({
  getPlatformConfig: vi.fn(),
  loadAccountCredentials: vi.fn(),
  loadPlatformCredentials: vi.fn(),
  normalizeEnvironment: (v: unknown) => (v === "live" ? "live" : "sandbox"),
  saveAccountCredentials: vi.fn(),
  serviceClient: vi.fn(),
}));

// Imported through runtime specifiers: these are Deno modules and must stay
// out of the browser TypeScript program.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CRYPTO_PATH = "../../supabase/functions/_shared/provider-crypto.ts";
const MP_PATH = "../../supabase/functions/_shared/providers/mercado-pago.ts";
const crypto_: any = await import(/* @vite-ignore */ CRYPTO_PATH);
const mp: any = await import(/* @vite-ignore */ MP_PATH);

describe("credential encryption", () => {
  it("round-trips an encrypted credential blob", async () => {
    const payload = { access_token: "APP_USR-secret-token", refresh_token: "TG-refresh" };
    const encrypted = await crypto_.encryptCredentials(payload);

    expect(encrypted.blob).not.toContain("APP_USR");
    expect(encrypted.version).toBe(crypto_.ENCRYPTION_VERSION);

    const decrypted = await crypto_.decryptCredentials(encrypted.blob, encrypted.iv);
    expect(decrypted).toEqual(payload);
  });

  it("fails to decrypt when the ciphertext is tampered with", async () => {
    const { blob, iv } = await crypto_.encryptCredentials({ access_token: "abc" });
    const tampered = blob.slice(0, -4) + (blob.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(crypto_.decryptCredentials(tampered, iv)).rejects.toBeTruthy();
  });

  it("refuses to operate without an encryption key", async () => {
    const original = ENV.PROVIDER_CREDENTIALS_KEY;
    ENV.PROVIDER_CREDENTIALS_KEY = undefined;
    await expect(crypto_.encryptCredentials({ a: "b" })).rejects.toBeInstanceOf(
      crypto_.MissingEncryptionKeyError,
    );
    ENV.PROVIDER_CREDENTIALS_KEY = original;
  });
});

describe("secret masking", () => {
  it("never reveals more than the last four characters", () => {
    const masks = crypto_.buildCredentialMasks({
      access_token: "APP_USR-1234567890-abcd",
      client_secret: "sup3r-s3cret-value",
      missing: undefined,
    });
    expect(masks.access_token.present).toBe(true);
    expect(masks.access_token.mask).toMatch(/abcd$/);
    expect(masks.access_token.mask).not.toContain("APP_USR-1234567890");
    expect(masks.client_secret.mask).not.toContain("sup3r");
    expect(masks.missing).toEqual({ present: false, mask: null });
  });
});

describe("mercado pago status normalization", () => {
  it("maps provider statuses without collapsing disputes into refunds", () => {
    expect(mp.normalizeMercadoPagoStatus("approved")).toBe("approved");
    expect(mp.normalizeMercadoPagoStatus("rejected")).toBe("failed");
    expect(mp.normalizeMercadoPagoStatus("refunded")).toBe("refunded");
    expect(mp.normalizeMercadoPagoStatus("charged_back")).toBe("disputed");
    expect(mp.normalizeMercadoPagoStatus("in_mediation")).toBe("disputed");
    expect(mp.normalizeMercadoPagoStatus("in_process")).toBe("processing");
    expect(mp.normalizeMercadoPagoStatus("cancelled")).toBe("canceled");
  });

  it("treats an expired cancellation as expired", () => {
    expect(mp.normalizeMercadoPagoStatus("cancelled", "expired_preference")).toBe("expired");
  });
});

describe("mercado pago webhook signature", () => {
  const secret = "whsec-unit-test";
  const dataId = "1234567890";
  const requestId = "req-abc";

  const sign = async (ts: string) =>
    await crypto_.hmacSha256Hex(secret, `id:${dataId};request-id:${requestId};ts:${ts};`);

  it("accepts a correctly signed notification", async () => {
    const now = Date.now();
    const ts = String(Math.floor(now / 1000));
    const v1 = await sign(ts);
    const result = await mp.verifyMercadoPagoSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: requestId,
      dataId,
      secret,
      nowMs: now,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a forged signature", async () => {
    const now = Date.now();
    const ts = String(Math.floor(now / 1000));
    const result = await mp.verifyMercadoPagoSignature({
      xSignature: `ts=${ts},v1=${"0".repeat(64)}`,
      xRequestId: requestId,
      dataId,
      secret,
      nowMs: now,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("signature mismatch");
  });

  it("rejects a replayed notification outside the timestamp tolerance", async () => {
    const now = Date.now();
    const oldTs = String(Math.floor((now - 60 * 60 * 1000) / 1000));
    const v1 = await sign(oldTs);
    const result = await mp.verifyMercadoPagoSignature({
      xSignature: `ts=${oldTs},v1=${v1}`,
      xRequestId: requestId,
      dataId,
      secret,
      nowMs: now,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("timestamp outside tolerance");
  });

  it("rejects when no webhook secret is configured or the header is missing", async () => {
    expect((await mp.verifyMercadoPagoSignature({
      xSignature: "ts=1,v1=2",
      xRequestId: requestId,
      dataId,
      secret: "",
    })).ok).toBe(false);
    expect((await mp.verifyMercadoPagoSignature({
      xSignature: null,
      xRequestId: requestId,
      dataId,
      secret,
    })).ok).toBe(false);
  });
});

describe("oauth authorization url", () => {
  it("carries state and PKCE challenge without ever including a secret", () => {
    const url = mp.mpAuthorizationUrl({
      clientId: "app-id-123",
      redirectUri: "https://example.supabase.co/functions/v1/provider-connect-callback",
      state: "one-time-state",
      codeChallenge: "challenge-value",
    });
    expect(url).toContain("client_id=app-id-123");
    expect(url).toContain("state=one-time-state");
    expect(url).toContain("code_challenge=challenge-value");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).not.toContain("client_secret");
  });
});
