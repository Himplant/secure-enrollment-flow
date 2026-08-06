// Link actions for the international module.
//
//   send_initial  – first email; sets payment_status = link_sent + sent_at
//   send_reminder – re-sends the SAME active link (never invalidates it)
//   regenerate    – explicit, mints a NEW token and invalidates the old link
//
// Callers: Himplant admins (AAL2) and surgeon-office portal users.
// Distributor roles are read-only and are rejected here.
import { requireAdmin } from "../_shared/admin-auth.ts";
import { requirePortalUser } from "../_shared/portal-auth.ts";
import { requireIntlEnabled } from "../_shared/flags.ts";
import { sendConsultationLink } from "../_shared/intl-send-link.ts";
import { consultationLinkUrl, storeLinkToken } from "../_shared/intl-link-secret.ts";
import { generateConsultationToken, hashConsultationToken, tokenLast4 } from "../_shared/intl-token.ts";
import { createPolicySnapshot, resolveIntlPolicy } from "../_shared/intl-policy.ts";
import { enqueueZohoOutbox } from "../_shared/intl-zoho.ts";

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

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const consultationId = String(body?.consultation_id ?? "");
    const action = String(body?.action ?? "send_reminder");
    if (!consultationId) return json({ error: "consultation_id is required" }, 400);
    if (!["send_initial", "send_reminder", "regenerate"].includes(action)) {
      return json({ error: "Unknown action" }, 400);
    }

    // ---- Caller: admin OR surgeon-office portal user -------------------
    // deno-lint-ignore no-explicit-any
    let admin: any = null;
    let actor: { type: string; id?: string | null; email?: string | null };
    let scopedSurgeonIds: string[] | null = null;

    const adminAuth = await requireAdmin(req, { requireAal2: true });
    if (adminAuth.ok) {
      admin = adminAuth.supabaseAdmin;
      actor = { type: "admin", id: adminAuth.userId, email: adminAuth.email };
    } else {
      const portalAuth = await requirePortalUser(req, {
        anyRole: ["surgeon_admin", "surgeon_staff"],
      });
      if (!portalAuth.ok) return portalAuth.response;
      admin = portalAuth.supabaseAdmin;
      actor = { type: "portal", id: portalAuth.userId, email: portalAuth.email };
      scopedSurgeonIds = portalAuth.surgeonIds;
    }

    if (!admin) return json({ error: "Unauthorized" }, 401);

    let query = admin
      .from("consultations")
      .select(
        "id, surgeon_id, country, provider, payment_status, amount_minor, currency, preferred_language, zoho_record_id",
      )
      .eq("id", consultationId);

    if (scopedSurgeonIds) {
      query = query.in("surgeon_id", scopedSurgeonIds.length ? scopedSurgeonIds : ["00000000-0000-0000-0000-000000000000"]);
    }

    const { data: c } = await query.maybeSingle();
    if (!c) return json({ error: "Consultation not found" }, 404);

    const countryBlock = await requireIntlEnabled({ country: String(c.country) });
    if (countryBlock) return countryBlock;

    // ---- Regenerate ----------------------------------------------------
    if (action === "regenerate") {
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
      const expiresAt = new Date(
        Date.now() + Number(settings?.link_expiry_hours ?? 72) * 3600_000,
      ).toISOString();

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
        event_type: "link_regenerated",
        event_data: { expires_at: expiresAt, previous_link_invalidated: true },
        actor_type: actor.type,
        actor_id: actor.id ?? null,
        actor_email: actor.email ?? null,
      });

      if (c.zoho_record_id) {
        await enqueueZohoOutbox(admin, consultationId, "upsert_consultation", {
          consultation_id: consultationId,
          payment_status: "link_created",
          event: "link_regenerated",
        });
      }

      const send = await sendConsultationLink(admin, consultationId, "initial_link", actor);

      return json({
        ok: true,
        action,
        payment_url: consultationLinkUrl(token),
        token_last4: tokenLast4(token),
        expires_at: expiresAt,
        email_sent: send.ok,
        email_error: send.ok ? null : (send.error ?? send.suppressed ?? null),
        previous_link_invalidated: true,
      });
    }

    // ---- Send / remind --------------------------------------------------
    const kind = action === "send_initial" ? "initial_link" : "reminder";
    const send = await sendConsultationLink(admin, consultationId, kind, actor);
    if (!send.ok) return json({ error: send.error, suppressed: send.suppressed ?? null }, send.status);

    return json({ ok: true, action, message_id: send.messageId ?? null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
