// Encryption + masking for payment-provider credentials.
//
// Every real credential (platform client secret, surgeon OAuth tokens,
// webhook secrets) is stored as a single AES-256-GCM encrypted JSON blob in a
// `private.*` table reachable only by the service role. Nothing plaintext is
// ever written to a public table, a log line, an event payload or a response.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const ENCRYPTION_VERSION = 1;

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super("PROVIDER_CREDENTIALS_KEY is not configured");
    this.name = "MissingEncryptionKeyError";
  }
}

async function aesKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("PROVIDER_CREDENTIALS_KEY");
  if (!raw || raw.length < 16) throw new MissingEncryptionKeyError();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromB64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export interface EncryptedBlob {
  blob: string;
  iv: string;
  version: number;
}

export async function encryptCredentials(payload: Record<string, unknown>): Promise<EncryptedBlob> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(payload))),
  );
  return { blob: toB64(cipher), iv: toB64(iv), version: ENCRYPTION_VERSION };
}

export async function decryptCredentials(
  blob: string,
  iv: string,
): Promise<Record<string, unknown>> {
  const key = await aesKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) },
    key,
    fromB64(blob),
  );
  return JSON.parse(dec.decode(plain)) as Record<string, unknown>;
}

/**
 * Safe display metadata for a secret: never more than the last 4 characters.
 * Short values are masked entirely.
 */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/** Builds the `credential_masks` jsonb kept on public metadata rows. */
export function buildCredentialMasks(
  values: Record<string, string | null | undefined>,
): Record<string, { present: boolean; mask: string | null }> {
  const out: Record<string, { present: boolean; mask: string | null }> = {};
  for (const [field, value] of Object.entries(values)) {
    const present = !!(value && String(value).trim());
    out[field] = { present, mask: present ? maskSecret(value) : null };
  }
  return out;
}

/** Constant-time string comparison for signature checks. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PKCE: random verifier + S256 challenge. */
export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
  return toB64(digest).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
