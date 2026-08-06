// Public read of a consultation by its raw link token.
// Returns only what the payment page needs — never merchant credentials,
// internal ids, agent notes, or CRM references.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireIntlEnabled } from "../_shared/flags.ts";
import { hashConsultationToken } from "../_shared/intl-token.ts";

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
    const body = await req.json().catch(() => null) as { token?: string } | null;
    const token = body?.token?.trim();
    if (!token || token.length < 16) return json({ error: "Invalid link" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const tokenHash = await hashConsultationToken(token);
    const { data: c } = await admin
      .from("consultations")
      .select(
        "id, amount_minor, currency, country, provider, payment_status, consultation_status, expires_at, opened_at, provider_checkout_url, surgeon_id, patient_id, policy_id",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!c) return json({ error: "Link not found" }, 404);

    const flagBlock = await requireIntlEnabled({
      country: c.country as string,
      provider: c.provider as string,
    });
    if (flagBlock) return flagBlock;

    const expired = new Date(c.expires_at as string).getTime() < Date.now();

    // First open is recorded once, and only while the link is still actionable.
    if (!c.opened_at && !expired && ["link_created", "link_sent"].includes(c.payment_status as string)) {
      await admin
        .from("consultations")
        .update({ opened_at: new Date().toISOString(), payment_status: "link_opened" })
        .eq("id", c.id);
      await admin.from("consultation_events").insert({
        consultation_id: c.id,
        event_type: "link_opened",
        actor_type: "patient",
      });
    }

    const [{ data: surgeon }, { data: patient }, { data: policy }] = await Promise.all([
      admin.from("surgeons").select("name, specialty, city, country, timezone").eq("id", c.surgeon_id).maybeSingle(),
      admin.from("consultation_patients").select("full_name, email, preferred_language").eq("id", c.patient_id).maybeSingle(),
      c.policy_id
        ? admin
            .from("international_policies")
            .select("version, terms_text, terms_url, privacy_url, cancellation_policy, no_show_policy")
            .eq("id", c.policy_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    return json({
      consultation: {
        id: c.id,
        amount_minor: c.amount_minor,
        currency: c.currency,
        country: c.country,
        provider: c.provider,
        payment_status: expired && c.payment_status !== "approved" ? "expired" : c.payment_status,
        consultation_status: c.consultation_status,
        expires_at: c.expires_at,
        checkout_url: c.provider_checkout_url,
      },
      surgeon,

      patient,
      policy,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
