// Zoho outbox worker: idempotent CRM delivery with exponential backoff,
// attempt limits and a dead-letter state. Admins can retry dead items.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { addZohoNote, logIntegration, writeConsultationToZoho } from "../_shared/intl-zoho.ts";
import { consultationLinkUrl, readLinkToken } from "../_shared/intl-link-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MAX_ATTEMPTS = 6;
const backoffMs = (attempt: number) => Math.min(6 * 3600_000, 60_000 * Math.pow(3, attempt));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  let manualRetryId: string | null = null;

  if (!isCron) {
    // Manual retry / on-demand run from the admin dashboard.
    const auth = await requireAdmin(req, { requireAal2: true });
    if (!auth.ok) return auth.response;
    manualRetryId = body.retry_id ? String(body.retry_id) : null;

    if (manualRetryId) {
      await admin
        .from("intl_zoho_outbox")
        .update({ status: "pending", next_attempt_at: new Date().toISOString(), last_error: null })
        .eq("id", manualRetryId);
    }
  }

  let query = admin
    .from("intl_zoho_outbox")
    .select("*")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(25);

  if (manualRetryId) query = admin.from("intl_zoho_outbox").select("*").eq("id", manualRetryId);

  const { data: items } = await query;
  const results: { id: string; status: string; error?: string }[] = [];

  for (const item of items ?? []) {
    const attempts = Number(item.attempts ?? 0) + 1;
    try {
      const consultationId = item.consultation_id as string | null;
      if (!consultationId) throw new Error("Outbox item has no consultation");

      const { data: c } = await admin
        .from("consultations")
        .select(
          "id, zoho_module, zoho_record_id, token_last4, expires_at, payment_status, consultation_status, surgery_status, amount_minor, currency, provider, country, surgeon_id, terms_version, paid_at",
        )
        .eq("id", consultationId)
        .maybeSingle();

      if (!c) throw new Error("Consultation not found");
      if (!c.zoho_module || !c.zoho_record_id) {
        await admin
          .from("intl_zoho_outbox")
          .update({ status: "sent", attempts, last_error: "no CRM record linked" })
          .eq("id", item.id);
        results.push({ id: String(item.id), status: "skipped" });
        continue;
      }

      const { data: surgeon } = await admin
        .from("surgeons")
        .select("name")
        .eq("id", c.surgeon_id as string)
        .maybeSingle();

      // Write the REAL patient link, exactly like the U.S. flow does.
      const rawToken = await readLinkToken(admin, consultationId);
      if (!rawToken) throw new Error("Link token unavailable — cannot write the CRM link");

      await writeConsultationToZoho({
        module: String(c.zoho_module),
        recordId: String(c.zoho_record_id),
        paymentUrl: consultationLinkUrl(rawToken),
        expiresAt: String(c.expires_at),
        tokenLast4: String(c.token_last4),
        paymentStatus: String(c.payment_status),
        paidAt: (c.paid_at as string) ?? null,
        amountMinor: Number(c.amount_minor),
        currency: String(c.currency),
        provider: String(c.provider),
        surgeonName: String(surgeon?.name ?? ""),
        country: String(c.country),
        policyVersion: (c.terms_version as string) ?? null,
      });

      if (item.operation === "add_note" && item.payload && (item.payload as Record<string, string>).note) {
        const p = item.payload as Record<string, string>;
        await addZohoNote(String(c.zoho_module), String(c.zoho_record_id), p.title ?? "Consultation update", p.note);
      }

      await admin
        .from("intl_zoho_outbox")
        .update({ status: "sent", attempts, last_error: null })
        .eq("id", item.id);

      await logIntegration(admin, {
        integration: "intl_zoho_outbox",
        direction: "outbound",
        entityType: String(c.zoho_module),
        entityId: String(c.zoho_record_id),
        requestSummary: { operation: item.operation, consultation_id: consultationId },
        responseStatus: 200,
        attempt: attempts,
      });

      results.push({ id: String(item.id), status: "sent" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unexpected error";
      const dead = attempts >= MAX_ATTEMPTS;

      await admin
        .from("intl_zoho_outbox")
        .update({
          status: dead ? "dead" : "pending",
          attempts,
          last_error: message,
          next_attempt_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
        })
        .eq("id", item.id);

      await logIntegration(admin, {
        integration: "intl_zoho_outbox",
        direction: "outbound",
        entityId: (item.consultation_id as string) ?? null,
        error: message,
        responseStatus: 500,
        attempt: attempts,
      });

      results.push({ id: String(item.id), status: dead ? "dead" : "retry", error: message });
    }
  }

  return json({ processed: results.length, results });
});
