// Scheduled reminder processor.
//
// Sends at most `max_reminders` reminders per consultation using the country's
// configured timing: N hours after creation while unpaid, and N hours before
// expiry. Suppressed on paid / canceled / refunded / disputed / expired links
// and when the patient has no email.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireIntlEnabled } from "../_shared/flags.ts";
import { sendConsultationLink } from "../_shared/intl-send-link.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SENDABLE = ["link_created", "link_sent", "link_opened"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!cronSecret || provided !== cronSecret) return json({ error: "Unauthorized" }, 401);

  const flagBlock = await requireIntlEnabled();
  if (flagBlock) return flagBlock;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: settingsRows } = await admin
    .from("international_country_settings")
    .select("country, reminders_enabled, reminder_hours_after_create, reminder_hours_before_expiry, max_reminders");

  const settings = new Map<string, Record<string, unknown>>();
  for (const row of settingsRows ?? []) settings.set(String(row.country), row);

  const { data: rows } = await admin
    .from("consultations")
    .select("id, country, created_at, expires_at, payment_status, reminder_count, last_reminder_at")
    .in("payment_status", SENDABLE)
    .gt("expires_at", new Date().toISOString())
    .limit(500);

  const now = Date.now();
  const results: { consultation_id: string; sent: boolean; reason?: string }[] = [];

  for (const c of rows ?? []) {
    const s = settings.get(String(c.country));
    if (!s || s.reminders_enabled === false) continue;

    const maxReminders = Number(s.max_reminders ?? 2);
    const sentCount = Number(c.reminder_count ?? 0);
    if (sentCount >= maxReminders) continue;

    // Never send two reminders within 12 hours.
    if (c.last_reminder_at && now - new Date(String(c.last_reminder_at)).getTime() < 12 * 3600_000) continue;

    const createdMs = new Date(String(c.created_at)).getTime();
    const expiresMs = new Date(String(c.expires_at)).getTime();
    const afterCreate = createdMs + Number(s.reminder_hours_after_create ?? 24) * 3600_000;
    const beforeExpiry = expiresMs - Number(s.reminder_hours_before_expiry ?? 24) * 3600_000;

    const due = now >= afterCreate || now >= beforeExpiry;
    if (!due) continue;

    const outcome = await sendConsultationLink(admin, String(c.id), "reminder", { type: "system" });
    results.push({
      consultation_id: String(c.id),
      sent: outcome.ok,
      reason: outcome.ok ? undefined : (outcome.suppressed ?? outcome.error),
    });
  }

  return json({ processed: results.length, results });
});
