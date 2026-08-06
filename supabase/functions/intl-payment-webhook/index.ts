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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-test-provider-secret, x-signature, x-request-id",
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

  // Idempotency WITHOUT permanently discarding transient failures:
  // an event is only "done" once it reaches processed / mismatch / orphan / dead.
  const eventKey = verification.eventId ?? verification.lookupId;
  const TERMINAL = ["processed", "mismatch", "orphan", "duplicate", "dead"];

  const { data: existingEvent } = await admin
    .from("processed_provider_events")
    .select("processing_status, attempts")
    .eq("provider", providerName)
    .eq("external_event_id", eventKey)
    .maybeSingle();

  if (existingEvent && TERMINAL.includes(String(existingEvent.processing_status))) {
    return ok();
  }

  const attemptNo = Number(existingEvent?.attempts ?? 0) + 1;

  if (existingEvent) {
    await admin
      .from("processed_provider_events")
      .update({ processing_status: "processing", attempts: attemptNo, updated_at: new Date().toISOString() })
      .eq("provider", providerName)
      .eq("external_event_id", eventKey);
  } else {
    await admin.from("processed_provider_events").insert({
      provider: providerName,
      external_event_id: eventKey,
      raw_payload: safeJson(rawBody),
      processing_status: "processing",
      attempts: attemptNo,
    });
  }

  const markStatus = async (status: string, error?: string) => {
    await admin
      .from("processed_provider_events")
      .update({
        processing_status: status,
        error: error ?? null,
        last_error: error ?? null,
        attempts: attemptNo,
        updated_at: new Date().toISOString(),
        next_attempt_at:
          status === "retryable_error"
            ? new Date(Date.now() + Math.min(6 * 3600_000, 60_000 * Math.pow(3, attemptNo))).toISOString()
            : null,
      })
      .eq("provider", providerName)
      .eq("external_event_id", eventKey);
  };

  try {
    // Real providers need the surgeon's own credentials to re-fetch the
    // payment, so the consultation is located first from the payload's
    // external_reference and the account id is then handed to the adapter.
    const hintedConsultationId = extractExternalReference(rawBody, url);
    let providerAccountId: string | null = null;
    if (hintedConsultationId) {
      const { data: hinted } = await admin
        .from("consultations")
        .select("provider_account_id")
        .eq("id", hintedConsultationId)
        .maybeSingle();
      providerAccountId = (hinted?.provider_account_id as string | null) ?? null;
    }
    if (!providerAccountId && providerName !== "test") {
      // Fall back to the only connected account able to see this payment.
      const { data: candidate } = await admin
        .from("provider_accounts")
        .select("id")
        .eq("provider", providerName)
        .eq("status", "connected")
        .eq("is_active", true)
        .limit(2);
      if ((candidate ?? []).length === 1) providerAccountId = candidate![0].id as string;
    }

    const payment = await provider.getPayment(verification.lookupId, { providerAccountId });
    const consultationId = payment.externalReference;
    if (!consultationId) {
      await markStatus("orphan", "no external reference");
      return ok();
    }

    const { data: c } = await admin
      .from("consultations")
      .select(
        "id, amount_minor, currency, provider, recipient_external_merchant_id, payment_status, surgeon_id",
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

    // Preserve the per-attempt record rather than only the latest summary.
    const attemptPatch = {
      status: payment.status,
      provider_payment_id: payment.providerPaymentId,
      raw_provider_payload: payment.raw as Record<string, unknown>,
      reconciled_at: new Date().toISOString(),
      failure_reason: payment.status === "failed" ? "provider reported failure" : null,
    };

    const { data: attemptRow } = await admin
      .from("consultation_payment_attempts")
      .select("id")
      .eq("consultation_id", c.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (attemptRow) {
      await admin.from("consultation_payment_attempts").update(attemptPatch).eq("id", attemptRow.id);
    } else {
      await admin.from("consultation_payment_attempts").insert({
        consultation_id: c.id,
        provider: providerName,
        provider_order_id: payment.providerOrderId,
        amount_minor: Number(c.amount_minor),
        currency: String(c.currency),
        ...attemptPatch,
      });
    }

    await admin.from("consultation_events").insert({
      consultation_id: c.id,
      event_type: `payment_${payment.status}`,
      event_data: { provider: providerName, payment_id: payment.providerPaymentId },
      actor_type: "system",
    });

    if (payment.status === "approved") {
      // SLA task for the surgeon to make first contact.
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
    await markStatus(attemptNo >= 6 ? "dead" : "retryable_error", e instanceof Error ? e.message : "unexpected");
    return ok();
  }
});

/** Best-effort read of the consultation id a provider payload points at. */
function extractExternalReference(raw: string, url: URL): string | null {
  const fromQuery = url.searchParams.get("external_reference");
  if (fromQuery) return fromQuery;
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const direct = body.external_reference;
    if (typeof direct === "string") return direct;
    const nested = (body.data as { external_reference?: unknown } | undefined)?.external_reference;
    if (typeof nested === "string") return nested;
  } catch { /* signature already validated; payload shape is advisory only */ }
  return null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}
