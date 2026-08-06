// Reconciliation for unresolved international payment attempts and stuck
// webhook events. Re-fetches the authoritative payment from the provider and
// re-applies the result; retryable webhook rows are re-queued.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireIntlEnabled } from "../_shared/flags.ts";
import { getProvider } from "../_shared/providers/registry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const flagBlock = await requireIntlEnabled();
  if (flagBlock) return flagBlock;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: Record<string, unknown>[] = [];

  // ---- 1. Unresolved payment attempts ---------------------------------
  const { data: attempts } = await admin
    .from("consultation_payment_attempts")
    .select("id, consultation_id, provider, provider_payment_id, provider_order_id, status")
    .is("reconciled_at", null)
    .in("status", ["link_created", "processing"])
    .lt("created_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(100);

  for (const a of attempts ?? []) {
    const provider = getProvider(String(a.provider));
    const lookupId = (a.provider_payment_id as string) ?? (a.provider_order_id as string);
    if (!provider || !lookupId) continue;

    try {
      const payment = await provider.getPayment(lookupId);
      await admin
        .from("consultation_payment_attempts")
        .update({
          status: payment.status,
          provider_payment_id: payment.providerPaymentId ?? a.provider_payment_id,
          raw_provider_payload: payment.raw as Record<string, unknown>,
          reconciled_at: new Date().toISOString(),
        })
        .eq("id", a.id);

      if (payment.status === "approved") {
        const { data: c } = await admin
          .from("consultations")
          .select("payment_status")
          .eq("id", a.consultation_id as string)
          .maybeSingle();

        if (c && c.payment_status !== "approved") {
          await admin
            .from("consultations")
            .update({
              payment_status: "approved",
              paid_at: new Date().toISOString(),
              consultation_status: "awaiting_clinic_contact",
              provider_payment_id: payment.providerPaymentId,
            })
            .eq("id", a.consultation_id as string);

          await admin.from("consultation_events").insert({
            consultation_id: a.consultation_id,
            event_type: "payment_reconciled",
            event_data: { provider: a.provider, payment_id: payment.providerPaymentId },
            actor_type: "system",
          });

          await admin.from("intl_zoho_outbox").insert({
            consultation_id: a.consultation_id,
            operation: "upsert_consultation",
            payload: { consultation_id: a.consultation_id, payment_status: "approved" },
          });
        }
      }

      results.push({ attempt: a.id, status: payment.status });
    } catch (e) {
      results.push({ attempt: a.id, error: e instanceof Error ? e.message : "lookup failed" });
    }
  }

  // ---- 2. Re-queue retryable webhook events ---------------------------
  const { data: retryable } = await admin
    .from("processed_provider_events")
    .select("provider, external_event_id, attempts")
    .eq("processing_status", "retryable_error")
    .lte("next_attempt_at", new Date().toISOString())
    .limit(100);

  for (const ev of retryable ?? []) {
    const attempts = Number(ev.attempts ?? 0);
    await admin
      .from("processed_provider_events")
      .update({
        processing_status: attempts >= 6 ? "dead" : "received",
        next_attempt_at: new Date(Date.now() + Math.min(6 * 3600_000, 60_000 * Math.pow(3, attempts))).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("provider", ev.provider)
      .eq("external_event_id", ev.external_event_id);
    results.push({ event: ev.external_event_id, requeued: attempts < 6 });
  }

  // ---- 3. Expire stale links ------------------------------------------
  const { data: expired } = await admin
    .from("consultations")
    .update({ payment_status: "expired", expired_at: new Date().toISOString() })
    .lt("expires_at", new Date().toISOString())
    .in("payment_status", ["link_created", "link_sent", "link_opened"])
    .select("id");

  return json({ reconciled: results.length, expired: (expired ?? []).length, results });
});
