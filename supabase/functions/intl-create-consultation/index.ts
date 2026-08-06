// Creates an international consultation payment invitation.
// Admin-only, AAL2 enforced, and blocked entirely unless the international
// module + country + provider flags are all on.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireAdmin(req, { requireAal2: true });
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    const clinicId = String(body.clinic_id ?? "");
    const surgeonId = body.surgeon_id ? String(body.surgeon_id) : null;
    const patientName = String(body.patient_name ?? "").trim();
    const patientEmail = body.patient_email ? String(body.patient_email).trim() : null;
    const patientPhone = body.patient_phone ? String(body.patient_phone).trim() : null;
    const language = String(body.preferred_language ?? "es");
    const amountMinor = Number(body.amount_minor);

    if (!clinicId) return json({ error: "clinic_id is required" }, 400);
    if (!patientName) return json({ error: "patient_name is required" }, 400);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return json({ error: "amount_minor must be a positive integer" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: clinic } = await admin
      .from("clinics")
      .select("id, name, country, region_id, default_currency, active_provider, is_active")
      .eq("id", clinicId)
      .maybeSingle();

    if (!clinic || !clinic.is_active) return json({ error: "Clinic not found or inactive" }, 404);

    const country = clinic.country as string;

    // Country settings gate the fee range, currency, and allowed providers.
    const { data: settings } = await admin
      .from("international_country_settings")
      .select("*")
      .eq("country", country)
      .maybeSingle();

    if (!settings || !settings.is_enabled) {
      return json({ error: `Consultations are not enabled for ${country}` }, 503);
    }

    const currency = String(body.currency ?? clinic.default_currency ?? settings.default_currency);

    if (amountMinor < Number(settings.min_fee_minor)) {
      return json({ error: "Amount is below the minimum consultation fee" }, 400);
    }
    if (settings.max_fee_minor && amountMinor > Number(settings.max_fee_minor)) {
      return json({ error: "Amount is above the maximum consultation fee" }, 400);
    }

    // Resolve the recipient merchant account. No valid account = no invitation.
    const requested = body.provider ? String(body.provider) : null;
    const allowed = (settings.allowed_providers ?? []) as string[];

    const { data: accounts } = await admin
      .from("provider_accounts")
      .select("id, provider, external_merchant_id, currency, status, is_active")
      .eq("clinic_id", clinicId)
      .eq("status", "connected")
      .eq("is_active", true);

    const candidates = (accounts ?? []).filter(
      (a) =>
        allowed.includes(a.provider as string) &&
        String(a.currency).toUpperCase() === currency.toUpperCase() &&
        (!requested || a.provider === requested) &&
        (requested || !clinic.active_provider || a.provider === clinic.active_provider),
    );

    const account = candidates[0];
    if (!account) {
      return json(
        { error: "This clinic has no connected payment account for the requested provider and currency" },
        409,
      );
    }

    const flagBlock = await requireIntlEnabled({
      country,
      provider: account.provider as string,
    });
    if (flagBlock) return flagBlock;

    // Patient record (international patients are kept out of the U.S. `patients` table).
    const { data: patient, error: patientErr } = await admin
      .from("consultation_patients")
      .insert({
        full_name: patientName,
        email: patientEmail,
        phone: patientPhone,
        country,
        preferred_language: language,
        notes: body.notes ? String(body.notes) : null,
      })
      .select("id")
      .single();

    if (patientErr) return json({ error: patientErr.message }, 400);

    const token = generateConsultationToken();
    const tokenHash = await hashConsultationToken(token);
    const expiryHours = Number(settings.link_expiry_hours ?? 72);
    const expiresAt = new Date(Date.now() + expiryHours * 3600_000).toISOString();

    const { data: activePolicy } = await admin
      .from("international_policies")
      .select("id, version, content_sha256")
      .eq("country", country)
      .eq("is_active", true)
      .order("effective_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: consultation, error: consultErr } = await admin
      .from("consultations")
      .insert({
        token_hash: tokenHash,
        token_last4: tokenLast4(token),
        expires_at: expiresAt,
        clinic_id: clinicId,
        surgeon_id: surgeonId,
        region_id: clinic.region_id,
        patient_id: patient.id,
        agent_email: auth.email,
        amount_minor: amountMinor,
        currency,
        country,
        provider: account.provider,
        provider_account_id: account.id,
        recipient_external_merchant_id: account.external_merchant_id,
        payment_status: "link_created",
        consultation_status: "awaiting_payment",
        policy_id: activePolicy?.id ?? null,
        terms_version: activePolicy?.version ?? null,
        terms_sha256: activePolicy?.content_sha256 ?? null,
      })
      .select("id")
      .single();

    if (consultErr) return json({ error: consultErr.message }, 400);

    await admin.from("consultation_events").insert({
      consultation_id: consultation.id,
      event_type: "consultation_created",
      event_data: { amount_minor: amountMinor, currency, provider: account.provider },
      actor_type: "admin",
      actor_id: auth.userId,
      actor_email: auth.email,
    });

    const appUrl = Deno.env.get("APP_URL") ?? "";
    return json({
      consultation_id: consultation.id,
      payment_url: `${appUrl}/consult/${token}`,
      expires_at: expiresAt,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
