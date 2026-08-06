// International consultation links expire in EXACTLY 48 hours — the same
// window as U.S. SecurePay enrollment links. This is a server-side constant:
// no caller (Zoho, admin UI, portal) may override it.

export const LINK_EXPIRY_HOURS = 48;

/** Always now + 48h, regardless of any requested override. */
export function linkExpiresAt(from: Date = new Date()): string {
  return new Date(from.getTime() + LINK_EXPIRY_HOURS * 3600_000).toISOString();
}

/**
 * Rejects any explicit expiry override that isn't exactly 48 hours.
 * Returns an error string, or null when the request is acceptable.
 */
export function rejectExpiryOverride(requested: unknown): string | null {
  if (requested === null || requested === undefined || requested === "") return null;
  const hours = Number(requested);
  if (Number.isFinite(hours) && hours === LINK_EXPIRY_HOURS) return null;
  return `Consultation links always expire in ${LINK_EXPIRY_HOURS} hours; expires_in_hours cannot be overridden.`;
}

export function isExpired(expiresAt: string | Date): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

const NON_EXPIRABLE = ["approved", "refunded", "disputed", "canceled", "expired"];

/**
 * Persists expiry once a link's window has passed: payment_status='expired',
 * expired_at, and a consultation event. Returns true when it expired the row.
 */
// deno-lint-ignore no-explicit-any
export async function persistExpiryIfNeeded(admin: any, c: {
  id: string;
  expires_at: string;
  payment_status: string;
  expired_at?: string | null;
}): Promise<boolean> {
  if (!isExpired(c.expires_at)) return false;
  if (NON_EXPIRABLE.includes(c.payment_status)) return false;

  const now = new Date().toISOString();
  await admin
    .from("consultations")
    .update({ payment_status: "expired", expired_at: c.expired_at ?? now })
    .eq("id", c.id);

  await admin.from("consultation_events").insert({
    consultation_id: c.id,
    event_type: "link_expired",
    event_data: { expires_at: c.expires_at },
    actor_type: "system",
  });

  return true;
}
