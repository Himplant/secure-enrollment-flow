// Portal read surface: consultations scoped to the caller's clinics /
// distributors. Never returns merchant credentials, raw link tokens, or
// anything from the U.S. enrollment tables.
import { requirePortalUser } from "../_shared/portal-auth.ts";
import { requireIntlEnabled } from "../_shared/flags.ts";

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

    const auth = await requirePortalUser(req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const consultationId = body.consultation_id ? String(body.consultation_id) : null;
    const admin = auth.supabaseAdmin;

    if (auth.surgeonIds.length === 0) {
      return json({ consultations: [], clinics: [] });
    }

    const SELECT =
      "id, token_last4, surgeon_id, patient_id, amount_minor, currency, country, provider, " +
      "payment_status, consultation_status, surgery_status, expires_at, sent_at, opened_at, paid_at, " +
      "first_contact_at, scheduled_at, rescheduled_count, consulted_at, no_show_at, closed_at, " +
      "outcome_notes, created_at, updated_at";

    // ---- Detail --------------------------------------------------------
    if (consultationId) {
      const { data: c } = await admin
        .from("consultations")
        .select(SELECT)
        .eq("id", consultationId)
        .in("surgeon_id", auth.surgeonIds)
        .maybeSingle();

      if (!c) return json({ error: "Consultation not found" }, 404);

      const [{ data: patient }, { data: clinic }, { data: events }] = await Promise.all([
        admin
          .from("consultation_patients")
          .select("full_name, email, phone, preferred_language, notes")
          .eq("id", c.patient_id as string)
          .maybeSingle(),
        admin.from("surgeons").select("name, city, country, timezone").eq("id", c.surgeon_id as string).maybeSingle(),
        admin
          .from("consultation_events")
          .select("event_type, event_data, actor_type, created_at")
          .eq("consultation_id", consultationId)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      const surgeon = c.surgeon_id
        ? (await admin.from("surgeons").select("name, specialty").eq("id", c.surgeon_id as string).maybeSingle()).data
        : null;

      return json({ consultation: c, patient, clinic, surgeon, events: events ?? [] });
    }

    // ---- List ----------------------------------------------------------
    let query = admin
      .from("consultations")
      .select(SELECT)
      .in("surgeon_id", auth.surgeonIds)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (body.clinic_id) {
      const clinicId = String(body.clinic_id);
      if (!auth.surgeonIds.includes(clinicId)) return json({ error: "Clinic is outside your scope" }, 403);
      query = query.eq("surgeon_id", clinicId);
    }
    if (body.payment_status) query = query.eq("payment_status", String(body.payment_status));
    if (body.consultation_status) query = query.eq("consultation_status", String(body.consultation_status));

    const { data: rows, error } = await query;
    if (error) return json({ error: error.message }, 400);

    const consultations = rows ?? [];
    const patientIds = [...new Set(consultations.map((r) => r.patient_id as string).filter(Boolean))];
    const surgeonIds = [...new Set(consultations.map((r) => r.surgeon_id as string).filter(Boolean))];

    const [{ data: patients }, { data: clinics }, surgeonRes] = await Promise.all([
      patientIds.length
        ? admin.from("consultation_patients").select("id, full_name, email, phone").in("id", patientIds)
        : Promise.resolve({ data: [] }),
      admin.from("surgeons").select("id, name, city, country").in("id", auth.surgeonIds),
      surgeonIds.length
        ? admin.from("surgeons").select("id, name").in("id", surgeonIds)
        : Promise.resolve({ data: [] }),
    ]);

    const patientMap = Object.fromEntries((patients ?? []).map((p) => [p.id, p]));
    const surgeonMap = Object.fromEntries((surgeonRes.data ?? []).map((s) => [s.id, s]));

    return json({
      consultations: consultations.map((c) => ({
        ...c,
        patient: patientMap[c.patient_id as string] ?? null,
        surgeon: surgeonMap[c.surgeon_id as string] ?? null,
      })),
      clinics: clinics ?? [],
      memberships: auth.memberships,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
