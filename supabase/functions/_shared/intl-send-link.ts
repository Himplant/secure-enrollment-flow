// Shared "send the payment link" behaviour for initial sends and reminders.
// The SAME active link is reused — regeneration is a separate explicit action.

import { consultationLinkUrl, readLinkToken } from "./intl-link-secret.ts";
import { REMINDER_BLOCKING_STATUSES, sendConsultationLinkEmail } from "./intl-email.ts";
import { enqueueZohoOutbox } from "./intl-zoho.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface SendLinkOutcome {
  ok: boolean;
  status: number;
  error?: string;
  messageId?: string | null;
  suppressed?: string;
}

export async function sendConsultationLink(
  admin: Admin,
  consultationId: string,
  kind: "initial_link" | "reminder",
  actor: { type: string; id?: string | null; email?: string | null },
): Promise<SendLinkOutcome> {
  const { data: c } = await admin
    .from("consultations")
    .select(
      "id, surgeon_id, patient_id, amount_minor, currency, payment_status, expires_at, preferred_language, reminder_count, zoho_module, zoho_record_id, token_last4",
    )
    .eq("id", consultationId)
    .maybeSingle();

  if (!c) return { ok: false, status: 404, error: "Consultation not found" };

  if (REMINDER_BLOCKING_STATUSES.includes(String(c.payment_status))) {
    return { ok: false, status: 409, suppressed: String(c.payment_status), error: "This link is no longer payable" };
  }
  if (new Date(String(c.expires_at)).getTime() < Date.now()) {
    return { ok: false, status: 410, suppressed: "expired", error: "This payment link has expired" };
  }

  const [{ data: patient }, { data: surgeon }] = await Promise.all([
    admin.from("consultation_patients").select("full_name, email, preferred_language").eq("id", c.patient_id).maybeSingle(),
    admin.from("surgeons").select("name").eq("id", c.surgeon_id).maybeSingle(),
  ]);

  if (!patient?.email) {
    return { ok: false, status: 422, suppressed: "no_email", error: "This patient has no email address on file" };
  }

  const token = await readLinkToken(admin, consultationId);
  if (!token) {
    return {
      ok: false,
      status: 409,
      error: "The stored link for this consultation cannot be recovered. Regenerate the link instead.",
    };
  }

  const language = String(c.preferred_language ?? patient.preferred_language ?? "es");

  const result = await sendConsultationLinkEmail(admin, {
    consultationId,
    recipient: String(patient.email),
    language,
    kind,
    paymentUrl: consultationLinkUrl(token),
    surgeonName: String(surgeon?.name ?? "Himplant"),
    patientName: String(patient.full_name ?? ""),
    amountMinor: Number(c.amount_minor),
    currency: String(c.currency),
    expiresAt: String(c.expires_at),
    actorType: actor.type,
    actorEmail: actor.email ?? null,
  });

  if (!result.ok) {
    await admin.from("consultation_events").insert({
      consultation_id: consultationId,
      event_type: kind === "reminder" ? "reminder_failed" : "link_send_failed",
      event_data: { error: result.error },
      actor_type: actor.type,
      actor_id: actor.id ?? null,
      actor_email: actor.email ?? null,
    });
    return { ok: false, status: 502, error: result.error };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  if (kind === "initial_link") {
    patch.payment_status = "link_sent";
    patch.sent_at = now;
  } else {
    patch.reminder_count = Number(c.reminder_count ?? 0) + 1;
    patch.last_reminder_at = now;
    if (c.payment_status === "link_created") {
      patch.payment_status = "link_sent";
      patch.sent_at = now;
    }
  }

  await admin.from("consultations").update(patch).eq("id", consultationId);

  await admin.from("consultation_events").insert({
    consultation_id: consultationId,
    event_type: kind === "reminder" ? "reminder_sent" : "link_sent",
    event_data: { recipient: patient.email, message_id: result.messageId },
    actor_type: actor.type,
    actor_id: actor.id ?? null,
    actor_email: actor.email ?? null,
  });

  if (c.zoho_record_id) {
    await enqueueZohoOutbox(admin, consultationId, "upsert_consultation", {
      consultation_id: consultationId,
      payment_status: patch.payment_status ?? c.payment_status,
      event: kind,
    });
  }

  return { ok: true, status: 200, messageId: result.messageId };
}
