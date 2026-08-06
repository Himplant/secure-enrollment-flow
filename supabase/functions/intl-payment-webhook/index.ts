// International payment webhook.
//
// Completely separate from `stripe-webhook`, which remains the single money
// truth for the U.S. enrollment programme and is never touched by this code.
//
// Rules enforced here:
//  1. Verify the provider's own signature scheme.
//  2. Idempotency via `processed_provider_events`.
//  3. Never trust the payload — always re-fetch the payment from the provider.
//  4. Match recipient merchant, amount, currency and external reference before
//     anything is marked approved.
//  5. Zoho is enqueued to the outbox, never called inline.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getProvider } from "../_shared/providers/registry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-test-provider-secret",
};

const ok = () => new Response(JSON.stringify({ received: true }), {
  status: 200,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const providerName = url.searchParams.get("provider") ?? "test";
  const provider = getProvider(providerName);
  const rawBody = await req.text();

  if (!provider) {
    await admin.from("integration_audit_logs").insert({
      integration: "intl_webhook",
      direction: "inbound",
      error: `Unknown provider ${providerName}`,
      response_status: 400,
    });
    return new Response("unknown provider", { status: 400, headers: corsHeaders });
  }

  const verification = await provider.verifyWebhook(req, rawBody);
  if (!verification.ok || !verification.lookupId) {
    await admin.from("integration_audit_logs").insert({
      integration: `intl_webhook_${providerName}`,
      direction: "inbound",
      error: verification.reason ?? "verification failed",
      response_status: 401,
    });
    return new Response("invalid signature", { status: 401, headers: corsHeaders });
  }

  // Idempotency — a unique violation means we already handled this event.
  const { error: dupeErr } = await admin.from("processed_provider_events").insert({
    provider: providerName,
    external_event_id: verification.eventId ?? verification.lookupId,
    raw_payload: safeJson(rawBody),
    processing_status: "received",
  });
  if (dupeErr) return ok();

  const eventKey = verification.eventId ?? verification.lookupId;
  const markStatus = async (status: string, error?: string) => {
    await admin
      .from("processed_provider_events")
      .update({ processing_status: status, error: error ?? null })
      .eq("provider", providerName)
      .eq("external_event_id", eventKey);
  };

  try {
    const payment = await provider.getPayment(verification.lookupId);
    const consultationId = payment.externalReference;
    if (!consultationId) {
      await markStatus("orphan", "no external reference");
      return ok();
    }

    const { data: c } = await admin
      .from("consultations")
      .select(
        "id, amount_minor, currency, provider, recipient_external_merchant_id, payment_status, clinic_id",
      )
      .eq("id", consultationId)
      .maybeSingle();

    if (!c) {
      await markStatus("orphan", "consultation not found");
      return ok();
    }

    const mismatches: string[] = [];
    if (c.provider !== providerName) mismatches.push("provider");
    if (payment.amountMinor !== null && Number(payment.amountMinor) !== Number(c.amount_minor)) {
      mismatches.push("amount");
    }
    if (payment.currency && payment.currency.toUpperCase() !== String(c.currency).toUpperCase()) {
      mismatches.push("currency");
    }
    if (
      c.recipient_external_merchant_id &&
      payment.recipientMerchantId &&
      payment.recipientMerchantId !== c.recipient_external_merchant_id
    ) {
      mismatches.push("recipient");
    }

    if (mismatches.length > 0) {
      await markStatus("mismatch", mismatches.join(","));
      await admin.from("consultation_events").insert({
        consultation_id: c.id,
        event_type: "payment_mismatch",
        event_data: { mismatches, provider: providerName },
        actor_type: "system",
      });
      return ok();
    }

    if (c.payment_status === "approved") {
      await markStatus("duplicate");
      return ok();
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      payment_status: payment.status,
      provider_payment_id: payment.providerPaymentId,
      provider_order_id: payment.providerOrderId,
    };

    if (payment.status === "approved") {
      update.paid_at = now;
      update.consultation_status = "awaiting_clinic_contact";
    } else if (payment.status === "failed") {
      update.failed_at = now;
    } else if (payment.status === "expired") {
      update.expired_at = now;
    } else if (payment.status === "refunded") {
      update.refunded_at = now;
    } else if (payment.status === "disputed") {
      update.disputed_at = now;
    }

    await admin.from("consultations").update(update).eq("id", c.id);

    await admin.from("consultation_events").insert({
      consultation_id: c.id,
      event_type: `payment_${payment.status}`,
      event_data: { provider: providerName, payment_id: payment.providerPaymentId },
      actor_type: "system",
    });

    if (payment.status === "approved") {
      // SLA task for the clinic to make first contact.
      const { data: settings } = await admin
        .from("international_country_settings")
        .select("sla_first_contact_hours")
        .eq("country", (await admin.from("surgeons").select("country").eq("id", c.surgeon_id).maybeSingle()).data?.country)
        .maybeSingle();

      const dueHours = Number(settings?.sla_first_contact_hours ?? 24);
      await admin.from("consultation_tasks").insert({
        consultation_id: c.id,
        surgeon_id: c.surgeon_id,
        task_type: "first_contact",
        due_at: new Date(Date.now() + dueHours * 3600_000).toISOString(),
      });
    }

    // CRM sync is queued — a Zoho outage must never fail a payment webhook.
    await admin.from("intl_zoho_outbox").insert({
      consultation_id: c.id,
      operation: "upsert_consultation",
      payload: { consultation_id: c.id, payment_status: payment.status },
    });

    await markStatus("processed");
    return ok();
  } catch (e) {
    await markStatus("error", e instanceof Error ? e.message : "unexpected");
    return ok();
  }
});

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}
