// Portal read surface: consultations scoped to the caller's surgeons /
// distributors. Never returns merchant credentials, raw link tokens, or
// anything from the U.S. enrollment tables.
import { applyWorkspace, requirePortalUser } from "../_shared/portal-auth.ts";
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

    const baseAuth = await requirePortalUser(req);
    if (!baseAuth.ok) return baseAuth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // Narrow to the organisation the caller is currently acting as.
    const auth = await applyWorkspace(baseAuth, body);
    if (!auth.ok) return auth.response;
    const consultationId = body.consultation_id ? String(body.consultation_id) : null;
    const admin = auth.supabaseAdmin;

    // Distributors get operational + payment visibility only. Internal patient
    // notes, clinical outcome notes and raw event payloads never leave the
    // clinic's own workspace.
    const isDistributorWorkspace = body.workspace_org_type
      ? body.workspace_org_type === "distributor"
      : auth.memberships.length > 0 && auth.memberships.every((m) => m.org_type === "distributor");

    const scrubConsultation = <T extends Record<string, unknown>>(c: T) =>
      isDistributorWorkspace ? { ...c, outcome_notes: null } : c;

    /** "Maria Lopez" -> "M. L." — enough to track a case, not to contact a patient. */
    const maskName = (name: unknown) =>
      String(name ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => `${part[0].toUpperCase()}.`)
        .join(" ") || "Patient";

    /** Distributors never receive patient contact details. */
    const scrubPatient = (p: Record<string, unknown> | null) => {
      if (!p) return p;
      if (!isDistributorWorkspace) return p;
      return { id: p.id ?? null, full_name: maskName(p.full_name), email: null, phone: null };
    };


    if (auth.surgeonIds.length === 0) {
      return json({ consultations: [], surgeons: [] });
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

      const [{ data: patient }, { data: surgeon }, { data: events }] = await Promise.all([
        admin
          .from("consultation_patients")
          .select(
            isDistributorWorkspace
              ? "full_name, email, phone, preferred_language"
              : "full_name, email, phone, preferred_language, notes",
          )
          .eq("id", c.patient_id as string)
          .maybeSingle(),
        admin
          .from("surgeons")
          .select("id, name, specialty, city, country, timezone")
          .eq("id", c.surgeon_id as string)
          .maybeSingle(),
        admin
          .from("consultation_events")
          .select("event_type, event_data, actor_type, created_at")
          .eq("consultation_id", consultationId)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      // Distributors see WHAT happened and WHEN, never the payload.
      const safeEvents = (events ?? []).map((e) =>
        isDistributorWorkspace
          ? { event_type: e.event_type, created_at: e.created_at }
          : e
      );

      return json({
        consultation: scrubConsultation(c),
        patient,
        surgeon,
        events: safeEvents,
      });
    }


    // ---- List ----------------------------------------------------------
    let query = admin
      .from("consultations")
      .select(SELECT)
      .in("surgeon_id", auth.surgeonIds)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (body.surgeon_id) {
      const surgeonId = String(body.surgeon_id);
      if (!auth.surgeonIds.includes(surgeonId)) return json({ error: "Surgeon is outside your scope" }, 403);
      query = query.eq("surgeon_id", surgeonId);
    }
    if (body.payment_status) query = query.eq("payment_status", String(body.payment_status));
    if (body.consultation_status) query = query.eq("consultation_status", String(body.consultation_status));

    const { data: rows, error } = await query;
    if (error) return json({ error: error.message }, 400);

    const consultations = rows ?? [];
    const patientIds = [...new Set(consultations.map((r) => r.patient_id as string).filter(Boolean))];

    const [{ data: patients }, { data: surgeons }] = await Promise.all([
      patientIds.length
        ? admin.from("consultation_patients").select("id, full_name, email, phone").in("id", patientIds)
        : Promise.resolve({ data: [] }),
      admin.from("surgeons").select("id, name, city, country, currency, consultation_fee_minor").in("id", auth.surgeonIds),
    ]);

    const patientMap = Object.fromEntries((patients ?? []).map((p) => [p.id, p]));
    const surgeonMap = Object.fromEntries((surgeons ?? []).map((s) => [s.id, s]));

    return json({
      consultations: consultations.map((c) => ({
        ...scrubConsultation(c),
        patient: patientMap[c.patient_id as string] ?? null,
        surgeon: surgeonMap[c.surgeon_id as string] ?? null,
      })),

      surgeons: surgeons ?? [],
      memberships: auth.memberships,
    });

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
