// Creates an international consultation payment invitation from the Himplant
// admin dashboard. All validation, policy resolution, duplicate handling and
// link minting live in the shared service that the Zoho endpoint also uses.
import { requireAdmin } from "../_shared/admin-auth.ts";
import { requireIntlEnabled } from "../_shared/flags.ts";
import { createIntlConsultation } from "../_shared/intl-consultation-service.ts";
import { sendConsultationLink } from "../_shared/intl-send-link.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const flagBlock = await requireIntlEnabled();
    if (flagBlock) return flagBlock;

    const auth = await requireAdmin(req, { requireAal2: true });
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    const result = await createIntlConsultation(auth.supabaseAdmin, {
      surgeonId: body.surgeon_id ? String(body.surgeon_id) : null,
      patientName: String(body.patient_name ?? ""),
      patientEmail: body.patient_email ? String(body.patient_email) : null,
      patientPhone: body.patient_phone ? String(body.patient_phone) : null,
      language: body.preferred_language ? String(body.preferred_language) : null,
      amountMinor: body.amount_minor !== undefined ? Number(body.amount_minor) : null,
      currency: body.currency ? String(body.currency) : null,
      provider: body.provider ? String(body.provider) : null,
      policyId: body.policy_id ? String(body.policy_id) : null,
      notes: body.notes ? String(body.notes) : null,
      expiresInHours: body.expires_in_hours ? Number(body.expires_in_hours) : null,
      actorType: "admin",
      actorId: auth.userId,
      actorEmail: auth.email,
    });

    if (!result.ok) return json({ error: result.error }, result.status);

    const send = body.send_email === false
      ? { ok: false, error: "Email skipped by request", suppressed: "skipped" as string | undefined }
      : await sendConsultationLink(auth.supabaseAdmin, result.consultationId, "initial_link", {
          type: "admin",
          id: auth.userId,
          email: auth.email,
        });

    return json({
      consultation_id: result.consultationId,
      payment_url: result.paymentUrl,
      token_last4: result.tokenLast4,
      expires_at: result.expiresAt,
      policy_version: result.policy.version,
      policy_rule: result.policy.rule,
      email_sent: send.ok,
      email_error: send.ok ? null : ((send as { error?: string }).error ?? null),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
