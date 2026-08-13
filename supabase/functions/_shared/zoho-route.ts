// Pure routing helpers for the single Zoho "Generate Enrollment Link" button.
// Deliberately dependency-free so the logic can be unit-tested outside Deno.

export const INTERNATIONAL_COUNTRIES = ["MX", "CO", "CL"] as const;
export type RoutedCountry = (typeof INTERNATIONAL_COUNTRIES)[number];

/** Country routing is ALWAYS based on the freshly synced CRM country code. */
export function isInternationalCountry(country: unknown): boolean {
  const code = String(country ?? "").trim().toUpperCase();
  return (INTERNATIONAL_COUNTRIES as readonly string[]).includes(code);
}

export type FlowType = "international" | "domestic";

export function flowForCountry(country: unknown): FlowType {
  return isInternationalCountry(country) ? "international" : "domestic";
}

/**
 * Legacy Deluge payloads hardcode `currency: "usd"` and sometimes
 * `expires_in_hours`. Neither may reach the international service: it derives
 * the country currency (COP for Colombia) and owns a fixed 48h expiry.
 */
export const STRIPPED_INTL_FIELDS = ["currency", "expires_in_hours"] as const;

export function sanitizeIntlPayload(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  for (const field of STRIPPED_INTL_FIELDS) delete out[field];
  return out;
}

/**
 * Backwards-compatible response shape so existing Deluge can keep reading
 * `enrollment_url` and `expires_at` for both flows.
 */
export function normalizeResponse(
  flowType: FlowType,
  surgeonCountry: string | null,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const url = flowType === "international" ? payload.consultation_url : payload.enrollment_url;

  const normalized: Record<string, unknown> = {
    success: payload.success === true,
    enrollment_url: url ?? null,
    expires_at: payload.expires_at ?? null,
    flow_type: flowType,
    surgeon_country: surgeonCountry,
  };

  if (payload.enrollment_id !== undefined) normalized.enrollment_id = payload.enrollment_id;
  if (payload.consultation_id !== undefined) normalized.consultation_id = payload.consultation_id;
  if (payload.provider !== undefined) normalized.provider = payload.provider;
  if (payload.currency !== undefined) normalized.currency = payload.currency;
  if (payload.token_last4 !== undefined) normalized.token_last4 = payload.token_last4;

  return normalized;
}

/** Error passthrough without patient PII. */
export function normalizeError(
  flowType: FlowType | null,
  surgeonCountry: string | null,
  payload: Record<string, unknown> | null,
  fallback: string,
): Record<string, unknown> {
  return {
    success: false,
    error: (payload?.error as string | undefined) ?? fallback,
    flow_type: flowType,
    surgeon_country: surgeonCountry,
  };
}
