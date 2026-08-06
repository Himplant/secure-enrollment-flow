// Scoped analytics for the external portal.
//
// Every metric is computed server-side from the caller's surgeon scope
// (own surgeon memberships + surgeons assigned to their distributors), so a
// distributor can never read another distributor's numbers by changing a
// request body. Nothing here touches U.S. enrollment data.
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

interface Row {
  id: string;
  surgeon_id: string | null;
  country: string;
  currency: string;
  amount_minor: number;
  payment_status: string;
  consultation_status: string;
  surgery_status: string;
  created_at: string;
  paid_at: string | null;
  first_contact_at: string | null;
  scheduled_at: string | null;
  consulted_at: string | null;
  no_show_at: string | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const hoursBetween = (from: string | null, to: string | null): number | null => {
  if (!from || !to) return null;
  const diff = Date.parse(to) - Date.parse(from);
  return Number.isFinite(diff) && diff >= 0 ? diff / 3_600_000 : null;
};

const rate = (numerator: number, denominator: number): number =>
  denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;

function summarize(rows: Row[]) {
  const paid = rows.filter((r) => r.payment_status === "approved");
  const contactHours = paid
    .map((r) => hoursBetween(r.paid_at, r.first_contact_at))
    .filter((v): v is number => v !== null);
  const scheduleHours = paid
    .map((r) => hoursBetween(r.paid_at, r.scheduled_at))
    .filter((v): v is number => v !== null);

  const completed = rows.filter((r) => r.consultation_status === "completed");
  const noShow = rows.filter((r) => r.consultation_status === "no_show");
  const scheduled = rows.filter((r) =>
    ["scheduled", "rescheduled", "completed", "no_show"].includes(r.consultation_status)
  );

  const recommended = rows.filter((r) =>
    ["recommended", "scheduled", "completed"].includes(r.surgery_status)
  );
  const surgeryScheduled = rows.filter((r) => ["scheduled", "completed"].includes(r.surgery_status));
  const surgeryCompleted = rows.filter((r) => r.surgery_status === "completed");

  return {
    links_created: rows.length,
    payments_approved: paid.length,
    payments_pending: rows.filter((r) =>
      ["link_created", "link_sent", "link_opened", "processing"].includes(r.payment_status)
    ).length,
    awaiting_contact: paid.filter((r) => r.consultation_status === "awaiting_clinic_contact").length,
    median_hours_to_first_contact: median(contactHours),
    median_hours_to_scheduled: median(scheduleHours),
    consultations_scheduled: scheduled.length,
    consultations_completed: completed.length,
    no_show_rate: rate(noShow.length, scheduled.length),
    surgery_recommended_rate: rate(recommended.length, completed.length),
    surgery_scheduled_rate: rate(surgeryScheduled.length, completed.length),
    surgery_completed_rate: rate(surgeryCompleted.length, completed.length),
    refund_rate: rate(rows.filter((r) => r.payment_status === "refunded").length, paid.length),
    dispute_rate: rate(rows.filter((r) => r.payment_status === "disputed").length, paid.length),
    payment_conversion_rate: rate(paid.length, rows.length),
    gross_paid_minor_by_currency: paid.reduce<Record<string, number>>((acc, r) => {
      acc[r.currency] = (acc[r.currency] ?? 0) + r.amount_minor;
      return acc;
    }, {}),
  };
}

function groupBy(rows: Row[], key: (r: Row) => string | null) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const flagBlock = await requireIntlEnabled();
    if (flagBlock) return flagBlock;

    const auth = await requirePortalUser(req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const admin = auth.supabaseAdmin;

    if (auth.surgeonIds.length === 0) {
      return json({ totals: summarize([]), by_surgeon: [], by_country: [], surgeons: [] });
    }

    let scopeIds = auth.surgeonIds;
    if (body.surgeon_id) {
      const requested = String(body.surgeon_id);
      if (!auth.surgeonIds.includes(requested)) {
        return json({ error: "Surgeon is outside your scope" }, 403);
      }
      scopeIds = [requested];
    }

    let query = admin
      .from("consultations")
      .select(
        "id, surgeon_id, country, currency, amount_minor, payment_status, consultation_status, " +
          "surgery_status, created_at, paid_at, first_contact_at, scheduled_at, consulted_at, no_show_at",
      )
      .in("surgeon_id", scopeIds)
      .limit(5000);

    if (body.from && !Number.isNaN(Date.parse(String(body.from)))) {
      query = query.gte("created_at", new Date(String(body.from)).toISOString());
    }
    if (body.to && !Number.isNaN(Date.parse(String(body.to)))) {
      query = query.lte("created_at", new Date(String(body.to)).toISOString());
    }

    const { data, error } = await query;
    if (error) return json({ error: error.message }, 400);

    const rows = (data ?? []) as unknown as Row[];

    const { data: surgeons } = await admin
      .from("surgeons")
      .select("id, name, city, country")
      .in("id", auth.surgeonIds);

    const surgeonMap = Object.fromEntries((surgeons ?? []).map((s) => [s.id as string, s]));

    const bySurgeon = [...groupBy(rows, (r) => r.surgeon_id)].map(([id, list]) => ({
      surgeon_id: id,
      surgeon_name: (surgeonMap[id]?.name as string | undefined) ?? "Unknown",
      ...summarize(list),
    }));

    const byCountry = [...groupBy(rows, (r) => r.country)].map(([country, list]) => ({
      country,
      ...summarize(list),
    }));

    return json({
      totals: summarize(rows),
      by_surgeon: bySurgeon.sort((a, b) => b.payments_approved - a.payments_approved),
      by_country: byCountry.sort((a, b) => b.payments_approved - a.payments_approved),
      surgeons: surgeons ?? [],
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
