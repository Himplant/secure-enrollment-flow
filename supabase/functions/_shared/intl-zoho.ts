// Zoho helpers for the INTERNATIONAL module only.
//
// Intentionally duplicated from `create-enrollment` rather than refactoring
// that file: the U.S. enrollment path must stay byte-for-byte unchanged.

import { surgeonLocationFields } from "./surgeon-country.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function getZohoAccessToken(): Promise<string> {
  const refreshToken = Deno.env.get("ZOHO_REFRESH_TOKEN");
  const clientId = Deno.env.get("ZOHO_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
  if (!refreshToken || !clientId || !clientSecret) throw new Error("Zoho credentials not configured");

  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Failed to refresh Zoho token: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

/** Pull a surgeon from Zoho's Surgeons module and upsert locally (same shape as the U.S. sync). */
export async function fetchAndUpsertSurgeonFromZoho(
  admin: Admin,
  zohoSurgeonId: string,
): Promise<{ id: string; name: string } | null> {
  try {
    const token = await getZohoAccessToken();
    const res = await fetch(`https://www.zohoapis.com/crm/v2/Surgeons/${zohoSurgeonId}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (!res.ok) return null;
    const s = (await res.json())?.data?.[0];
    if (!s) return null;

    const { data } = await admin
      .from("surgeons")
      .upsert(
        {
          zoho_id: s.id,
          name: s.Full_Name || s.Name || "Unknown",
          email: s.Email || null,
          phone: s.Phone || null,
          specialty: s.Specialty || null,
          is_active: true,
          ...surgeonLocationFields(s),
        },
        { onConflict: "zoho_id" },
      )
      .select("id, name")
      .maybeSingle();

    return data ?? null;
  } catch {
    return null;
  }
}

export interface ZohoConsultationWriteback {
  module: string;
  recordId: string;
  paymentUrl: string;
  expiresAt: string;
  tokenLast4: string;
  paymentStatus: string;
  paidAt?: string | null;
  amountMinor: number;
  currency: string;
  provider: string;
  surgeonName: string;
  country: string;
  policyVersion: string | null;
}

function zohoDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
}

function zohoDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * International payment statuses mapped onto the SAME Enrollment_Status
 * vocabulary the proven U.S. flow writes, so CRM views, reports and the
 * existing status-sync jobs keep working unchanged.
 */
const ENROLLMENT_STATUS: Record<string, string> = {
  draft: "created",
  link_created: "created",
  link_sent: "sent",
  link_opened: "opened",
  processing: "processing",
  approved: "paid",
  failed: "failed",
  expired: "expired",
  canceled: "canceled",
  refunded: "refunded",
  disputed: "refunded",
};

export function toEnrollmentStatus(paymentStatus: string): string {
  return ENROLLMENT_STATUS[paymentStatus] ?? "created";
}

export async function writeConsultationToZoho(w: ZohoConsultationWriteback): Promise<void> {
  const token = await getZohoAccessToken();

  // Proven U.S. Enrollment_* fields first — these are what CRM users, views
  // and the status-sync jobs already rely on.
  const payload: Record<string, unknown> = {
    Enrollment_Status: toEnrollmentStatus(w.paymentStatus),
    Enrollment_Link: w.paymentUrl,
    Enrollment_Date: zohoDate(new Date().toISOString()),
    Enrollment_Expires_At: zohoDateTime(w.expiresAt),
    Enrollment_Token_Last4: w.tokenLast4,
    // International-only context.
    Consultation_Amount: w.amountMinor / 100,
    Consultation_Currency: w.currency,
    Consultation_Provider: w.provider,
    Consultation_Country: w.country,
    Consultation_Policy_Version: w.policyVersion,
  };

  if (w.paidAt) payload.Enrollment_Paid_At = zohoDateTime(w.paidAt);

  const res = await fetch(`https://www.zohoapis.com/crm/v6/${w.module}/${w.recordId}`, {
    method: "PUT",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: [payload] }),
  });
  if (!res.ok) throw new Error(`Zoho writeback failed (${res.status}): ${await res.text()}`);
}

export async function addZohoNote(
  module: string,
  recordId: string,
  title: string,
  content: string,
): Promise<void> {
  const token = await getZohoAccessToken();
  const res = await fetch(`https://www.zohoapis.com/crm/v6/${module}/${recordId}/Notes`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: [{ Note_Title: title, Note_Content: content }] }),
  });
  if (!res.ok) throw new Error(`Zoho note failed (${res.status}): ${await res.text()}`);
}

/** Queue a CRM update instead of calling Zoho inline. */
export async function enqueueZohoOutbox(
  admin: Admin,
  consultationId: string | null,
  operation: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await admin.from("intl_zoho_outbox").insert({
    consultation_id: consultationId,
    operation,
    payload,
    status: "pending",
    next_attempt_at: new Date().toISOString(),
  });
}

export async function logIntegration(
  admin: Admin,
  entry: {
    integration: string;
    direction: "inbound" | "outbound";
    entityType?: string;
    entityId?: string | null;
    requestSummary?: Record<string, unknown>;
    responseStatus?: number | null;
    error?: string | null;
    attempt?: number;
  },
): Promise<void> {
  await admin.from("integration_audit_logs").insert({
    integration: entry.integration,
    direction: entry.direction,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    request_summary: entry.requestSummary ?? null,
    response_status: entry.responseStatus ?? null,
    error: entry.error ?? null,
    attempt: entry.attempt ?? 1,
  });
}
