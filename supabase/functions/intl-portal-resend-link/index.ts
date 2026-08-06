// Link management for portal users: refresh the expiry of an unpaid
// consultation link and mint a brand new token. The previous token is
// invalidated immediately because only its hash is stored.
import { requirePortalUser } from "../_shared/portal-auth.ts";
import { requireIntlEnabled } from "../_shared/flags.ts";
import { generateConsultationToken, hashConsultationToken, tokenLast4 } from "../_shared/intl-token.ts";

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

    const auth = await requirePortalUser(req, {
      anyRole: ["surgeon_admin", "surgeon_staff", "distributor_admin", "distributor_staff"],
    });
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const consultationId = String(body?.consultation_id ?? "");
    if (!consultationId) return json({ error: "consultation_id is required" }, 400);

    const admin = auth.supabaseAdmin;

    const { data: c } = await admin
      .from("consultations")
      .select("id, clinic_id, country, payment_status")
      .eq("id", consultationId)
      .in("surgeon_id", auth.surgeonIds.length ? auth.surgeonIds : ["00000000-0000-0000-0000-000000000000"])
      .maybeSingle();

    if (!c) return json({ error: "Consultation not found" }, 404);
    if (NON_REISSUABLE.includes(c.payment_status as string)) {
      return json({ error: "This payment link can no longer be reissued" }, 409);
    }

    const countryBlock = await requireIntlEnabled({ country: c.country as string });
    if (countryBlock) return countryBlock;

    const { data: settings } = await admin
      .from("international_country_settings")
      .select("link_expiry_hours")
      .eq("country", c.country as string)
      .maybeSingle();

    const hours = Number(settings?.link_expiry_hours ?? 72);
    const token = generateConsultationToken();
    const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();

    const { error: updErr } = await admin
      .from("consultations")
      .update({
        token_hash: await hashConsultationToken(token),
        token_last4: tokenLast4(token),
        expires_at: expiresAt,
        payment_status: "link_created",
        opened_at: null,
        expired_at: null,
      })
      .eq("id", consultationId);

    if (updErr) return json({ error: updErr.message }, 400);

    await admin.from("consultation_events").insert({
      consultation_id: consultationId,
      event_type: "portal_link_reissued",
      event_data: { expires_at: expiresAt },
      actor_type: "portal",
      actor_id: auth.userId,
      actor_email: auth.email,
    });

    const appUrl = Deno.env.get("APP_URL") ?? "";
    return json({ payment_url: `${appUrl}/consult/${token}`, expires_at: expiresAt });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
