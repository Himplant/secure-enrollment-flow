// Encrypted storage of the raw consultation link token.
//
// The public `consultations` table only ever holds the SHA-256 hash and the
// last 4 characters. The raw token lives encrypted (AES-256-GCM) in
// `private.consultation_link_secrets`, reachable only through two
// service-role-only SECURITY DEFINER functions. This lets us re-send the SAME
// link in a reminder without invalidating it.

import { tokenLast4 } from "./intl-token.ts";

type Admin = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

const enc = new TextEncoder();
const dec = new TextDecoder();

async function aesKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("INTL_LINK_ENC_KEY");
  if (!raw) throw new Error("INTL_LINK_ENC_KEY is not configured");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromB64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function storeLinkToken(admin: Admin, consultationId: string, token: string): Promise<void> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(token)),
  );

  const { error } = await admin.rpc("store_consultation_link_secret", {
    _consultation_id: consultationId,
    _ciphertext: toB64(cipher),
    _iv: toB64(iv),
    _last4: tokenLast4(token),
  });
  if (error) throw new Error(`Failed to store link secret: ${(error as { message?: string }).message}`);
}

export async function readLinkToken(admin: Admin, consultationId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("read_consultation_link_secret", {
    _consultation_id: consultationId,
  });
  if (error) return null;
  const row = Array.isArray(data) ? (data[0] as { ciphertext?: string; iv?: string } | undefined) : null;
  if (!row?.ciphertext || !row?.iv) return null;

  try {
    const key = await aesKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(row.iv) },
      key,
      fromB64(row.ciphertext),
    );
    return dec.decode(plain);
  } catch {
    return null;
  }
}

export function consultationLinkUrl(token: string): string {
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
  return `${appUrl}/consult/${token}`;
}
