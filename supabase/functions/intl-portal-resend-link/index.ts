// Portal link actions — kept for backwards compatibility.
//
// `resend` now means "send a reminder using the CURRENT active link".
// Regenerating a link (which invalidates the old one) requires
// `action: "regenerate"` and an explicit confirmation flag.
// Distributor roles are read-only and cannot use this endpoint.
import { applyWorkspace, requirePortalUser } from "../_shared/portal-auth.ts";
import { requireIntlEnabled } from "../_shared/flags.ts";
import { sendConsultationLink } from "../_shared/intl-send-link.ts";
import { consultationLinkUrl, storeLinkToken } from "../_shared/intl-link-secret.ts";
import { generateConsultationToken, hashConsultationToken, tokenLast4 } from "../_shared/intl-token.ts";
import { createPolicySnapshot, resolveIntlPolicy } from "../_shared/intl-policy.ts";
import { linkExpiresAt } from "../_shared/intl-expiry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const NON_REISSUABLE = ["approved", "processing", "refunded", "disputed"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const flagBlock = await requireIntlEnabled();
    if (flagBlock) return flagBlock;

    // Surgeon-office roles only — distributors are read-only.
    const baseAuth = await requirePortalUser(req, { anyRole: ["surgeon_admin", "surgeon_staff"] });
    if (!baseAuth.ok) return baseAuth.response;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    // Narrow to the organisation the caller is currently acting as.
    const auth = await applyWorkspace(baseAuth, body);
    if (!auth.ok) return auth.response;
    const consultationId = String(body?.consultation_id ?? "");
    const action = String(body?.action ?? "send_reminder");
    if (!consultationId) return json({ error: "consultation_id is required" }, 400);

    const admin = auth.supabaseAdmin;

    const { data: c } = await admin
      .from("consultations")
      .select("id, surgeon_id, country, provider, payment_status, amount_minor, currency, preferred_language")
      .eq("id", consultationId)
      .in("surgeon_id", auth.surgeonIds.length ? auth.surgeonIds : ["00000000-0000-0000-0000-000000000000"])
      .maybeSingle();

    if (!c) return json({ error: "Consultation not found" }, 404);

    const countryBlock = await requireIntlEnabled({ country: String(c.country) });
    if (countryBlock) return countryBlock;

    if (action === "send_reminder") {
      const send = await sendConsultationLink(admin, consultationId, "reminder", {
        type: "portal",
        id: auth.userId,
        email: auth.email,
      });
      if (!send.ok) return json({ error: send.error, suppressed: send.suppressed ?? null }, send.status);
      return json({ ok: true, action, message_id: send.messageId ?? null });
    }

    if (action !== "regenerate") return json({ error: "Unknown action" }, 400);
    if (body?.confirm_invalidate !== true) {
      return json(
        { error: "Regenerating the link invalidates the previous one. Send confirm_invalidate: true to proceed." },
        400,
      );
    }
    if (NON_REISSUABLE.includes(String(c.payment_status))) {
      return json({ error: "This payment link can no longer be reissued" }, 409);
    }

    const { data: settings } = await admin
      .from("international_country_settings")
      .select("link_expiry_hours, default_language")
      .eq("country", String(c.country))
      .maybeSingle();

    const language = String(c.preferred_language ?? settings?.default_language ?? "es");
    const resolved = await resolveIntlPolicy(admin, {
      surgeonId: String(c.surgeon_id),
      country: String(c.country),
      language,
      provider: String(c.provider),
    });
    if (!resolved) return json({ error: "No active policy — cannot regenerate this link" }, 409);

    const token = generateConsultationToken();
    const expiresAt = linkExpiresAt();

    const { error: updErr } = await admin
      .from("consultations")
      .update({
        token_hash: await hashConsultationToken(token),
        token_last4: tokenLast4(token),
        expires_at: expiresAt,
        payment_status: "link_created",
        sent_at: null,
        opened_at: null,
        expired_at: null,
      })
      .eq("id", consultationId);
    if (updErr) return json({ error: updErr.message }, 400);

    await storeLinkToken(admin, consultationId, token);
    await createPolicySnapshot(admin, {
      consultationId,
      resolved,
      surgeonId: String(c.surgeon_id),
      country: String(c.country),
      language,
      provider: String(c.provider),
      amountMinor: Number(c.amount_minor),
      currency: String(c.currency),
    });

    await admin.from("consultation_events").insert({
      consultation_id: consultationId,
      event_type: "portal_link_regenerated",
      event_data: { expires_at: expiresAt, previous_link_invalidated: true },
      actor_type: "portal",
      actor_id: auth.userId,
      actor_email: auth.email,
    });

    const send = await sendConsultationLink(admin, consultationId, "initial_link", {
      type: "portal",
      id: auth.userId,
      email: auth.email,
    });

    return json({
      ok: true,
      action,
      payment_url: consultationLinkUrl(token),
      token_last4: tokenLast4(token),
      expires_at: expiresAt,
      previous_link_invalidated: true,
      email_sent: send.ok,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
