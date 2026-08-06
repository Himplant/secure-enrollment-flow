// Portal write surface: surgeon staff advance the consultation lifecycle
// (contacted / scheduled / completed / no-show / canceled) and add outcome
// notes. Payment fields, amounts, and provider data are never writable here.
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

type Action =
  | "mark_contacted"
  | "schedule"
  | "reschedule"
  | "mark_completed"
  | "mark_no_show"
  | "mark_canceled"
  | "set_surgery_status"
  | "add_note";

// Distributor roles are READ-ONLY for patient progress by default. Only
// Himplant admins and surgeon-office users may advance a consultation.
const WRITE_ROLES = ["surgeon_admin", "surgeon_staff"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const flagBlock = await requireIntlEnabled();
    if (flagBlock) return flagBlock;

    const auth = await requirePortalUser(req, { anyRole: [...WRITE_ROLES] });
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    const consultationId = String(body.consultation_id ?? "");
    const action = String(body.action ?? "") as Action;
    if (!consultationId) return json({ error: "consultation_id is required" }, 400);

    const admin = auth.supabaseAdmin;

    const { data: c } = await admin
      .from("consultations")
      .select("id, surgeon_id, payment_status, consultation_status, surgery_status, rescheduled_count")
      .eq("id", consultationId)
      .in("surgeon_id", auth.surgeonIds.length ? auth.surgeonIds : ["00000000-0000-0000-0000-000000000000"])
      .maybeSingle();

    if (!c) return json({ error: "Consultation not found" }, 404);

    // The surgeon only owns the record once the patient has actually paid.
    const paid = c.payment_status === "approved";
    if (!paid && action !== "add_note") {
      return json({ error: "This consultation has not been paid yet" }, 409);
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};

    switch (action) {
      case "mark_contacted":
        patch.consultation_status = "patient_contacted";
        patch.first_contact_at = now;
        break;
      case "schedule":
      case "reschedule": {
        const scheduledAt = String(body.scheduled_at ?? "");
        if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
          return json({ error: "scheduled_at must be a valid date/time" }, 400);
        }
        patch.scheduled_at = new Date(scheduledAt).toISOString();
        patch.consultation_status = action === "reschedule" ? "rescheduled" : "scheduled";
        if (action === "reschedule") {
          patch.rescheduled_count = Number(c.rescheduled_count ?? 0) + 1;
        }
        break;
      }
      case "mark_completed":
        patch.consultation_status = "completed";
        patch.consulted_at = now;
        break;
      case "mark_no_show":
        patch.consultation_status = "no_show";
        patch.no_show_at = now;
        break;
      case "mark_canceled":
        patch.consultation_status = "clinic_canceled";
        patch.closed_at = now;
        break;
      case "set_surgery_status": {
        const status = String(body.surgery_status ?? "");
        const allowed = ["none", "recommended", "scheduled", "completed", "declined"];
        if (!allowed.includes(status)) return json({ error: "Invalid surgery status" }, 400);
        patch.surgery_status = status;
        if (status === "recommended") patch.surgery_recommended_at = now;
        if (status === "scheduled") patch.surgery_scheduled_at = now;
        if (status === "completed") patch.surgery_completed_at = now;
        break;
      }
      case "add_note":
        break;
      default:
        return json({ error: "Unknown action" }, 400);
    }

    if (typeof body.outcome_notes === "string") {
      patch.outcome_notes = body.outcome_notes.slice(0, 5000);
    }

    if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, 400);

    const { error: updErr } = await admin.from("consultations").update(patch).eq("id", consultationId);
    if (updErr) return json({ error: updErr.message }, 400);

    await admin.from("consultation_events").insert({
      consultation_id: consultationId,
      event_type: `portal_${action}`,
      event_data: patch,
      actor_type: "portal",
      actor_id: auth.userId,
      actor_email: auth.email,
    });

    // Close any open surgeon task once first contact happens.
    if (action === "mark_contacted" || action === "schedule") {
      await admin
        .from("consultation_tasks")
        .update({ completed_at: now, completed_by: auth.userId })
        .eq("consultation_id", consultationId)
        .is("completed_at", null);
    }

    return json({ ok: true, updated: patch });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
