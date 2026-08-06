// International payment-link emails (Resend), EN + ES.
//
// Separate from `send-confirmation-email.ts`, which serves the U.S.
// enrollment flow and must not change.

import { Resend } from "npm:resend@2.0.0";
import { formatMoney } from "./providers/money.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export const TEMPLATE_VERSION = "intl-v1";

export type MessageKind = "initial_link" | "reminder";

export interface SendLinkEmailInput {
  consultationId: string;
  recipient: string;
  language: string;
  kind: MessageKind;
  paymentUrl: string;
  surgeonName: string;
  patientName: string;
  amountMinor: number;
  currency: string;
  expiresAt: string;
  actorType?: string;
  actorEmail?: string | null;
}

export interface SendResult {
  ok: boolean;
  messageId?: string | null;
  error?: string;
  messageRowId: string;
}

function body(input: SendLinkEmailInput) {
  const es = (input.language || "es").toLowerCase().startsWith("es");
  const amount = formatMoney(input.amountMinor, input.currency, es ? "es-419" : "en-US");
  const expires = new Date(input.expiresAt).toLocaleString(es ? "es-419" : "en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const reminder = input.kind === "reminder";

  const subject = es
    ? reminder
      ? `Recordatorio: complete el pago de su consulta con ${input.surgeonName}`
      : `Su enlace de pago para la consulta con ${input.surgeonName}`
    : reminder
      ? `Reminder: complete your consultation payment with ${input.surgeonName}`
      : `Your consultation payment link with ${input.surgeonName}`;

  const intro = es
    ? reminder
      ? `Aún no hemos recibido el pago de su consulta. Su enlace sigue siendo válido.`
      : `Gracias por su interés. A continuación encontrará el enlace seguro para pagar su consulta.`
    : reminder
      ? `We have not yet received your consultation payment. Your link is still valid.`
      : `Thank you for your interest. Below is the secure link to pay for your consultation.`;

  const cta = es ? "Pagar la consulta" : "Pay for consultation";
  const feeLabel = es ? "Importe de la consulta" : "Consultation fee";
  const expiryLabel = es ? "El enlace vence el" : "Link expires on";
  const note = es
    ? "El pago se realiza directamente al consultorio del cirujano. La tarifa de consulta no es reembolsable según la política aceptada al pagar."
    : "Payment is made directly to the surgeon's office. The consultation fee is non-refundable per the policy accepted at checkout.";

  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <h1 style="font-size:20px;margin:0 0 16px">${es ? "Hola" : "Hello"} ${escapeHtml(input.patientName)},</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px">${intro}</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:14px">
      <tr><td style="padding:8px 0;color:#555">${es ? "Cirujano" : "Surgeon"}</td><td style="padding:8px 0;text-align:right"><strong>${escapeHtml(input.surgeonName)}</strong></td></tr>
      <tr><td style="padding:8px 0;color:#555">${feeLabel}</td><td style="padding:8px 0;text-align:right"><strong>${amount}</strong></td></tr>
      <tr><td style="padding:8px 0;color:#555">${expiryLabel}</td><td style="padding:8px 0;text-align:right">${expires} UTC</td></tr>
    </table>
    <p style="margin:0 0 28px"><a href="${input.paymentUrl}" style="background:#0f172a;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;display:inline-block;font-weight:bold">${cta}</a></p>
    <p style="font-size:12px;color:#666;line-height:1.6;margin:0">${note}</p>
  </div></body></html>`;

  const text = `${es ? "Hola" : "Hello"} ${input.patientName},\n\n${intro}\n\n${feeLabel}: ${amount}\n${expiryLabel}: ${expires} UTC\n\n${cta}: ${input.paymentUrl}\n\n${note}`;

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export async function sendConsultationLinkEmail(
  admin: Admin,
  input: SendLinkEmailInput,
): Promise<SendResult> {
  const { subject, html, text } = body(input);

  const { data: row } = await admin
    .from("consultation_messages")
    .insert({
      consultation_id: input.consultationId,
      message_type: input.kind,
      recipient: input.recipient,
      language: input.language,
      template_version: TEMPLATE_VERSION,
      status: "queued",
      actor_type: input.actorType ?? "system",
      actor_email: input.actorEmail ?? null,
    })
    .select("id")
    .single();

  const messageRowId = row?.id as string;
  const apiKey = Deno.env.get("RESEND_API_KEY");

  if (!apiKey) {
    await admin
      .from("consultation_messages")
      .update({ status: "failed", error: "RESEND_API_KEY not configured", failed_at: new Date().toISOString() })
      .eq("id", messageRowId);
    return { ok: false, error: "RESEND_API_KEY not configured", messageRowId };
  }

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: "Himplant® <noreply@himplant.com>",
      to: [input.recipient],
      subject,
      html,
      text,
    });

    if (result.error) throw new Error(result.error.message ?? "Resend rejected the message");

    await admin
      .from("consultation_messages")
      .update({
        status: "sent",
        provider_message_id: result.data?.id ?? null,
        sent_at: new Date().toISOString(),
      })
      .eq("id", messageRowId);

    return { ok: true, messageId: result.data?.id ?? null, messageRowId };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown send error";
    await admin
      .from("consultation_messages")
      .update({ status: "failed", error: message, failed_at: new Date().toISOString() })
      .eq("id", messageRowId);
    return { ok: false, error: message, messageRowId };
  }
}

/** Reminders are suppressed on any terminal or already-paid state. */
export const REMINDER_BLOCKING_STATUSES = [
  "approved",
  "processing",
  "canceled",
  "refunded",
  "disputed",
  "expired",
];
