// Consultation link tokens.
//
// Only a SHA-256 hash is stored (`consultations.token_hash`), plus the last 4
// characters for support lookups. The raw token exists solely in the link that
// is sent to the patient.

export function generateConsultationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashConsultationToken(token: string): Promise<string> {
  const secret = Deno.env.get("INTL_TOKEN_SECRET") ?? Deno.env.get("ENROLLMENT_SHARED_SECRET") ?? "";
  const data = new TextEncoder().encode(`${secret}:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}
