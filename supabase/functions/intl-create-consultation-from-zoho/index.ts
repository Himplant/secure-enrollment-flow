// Zoho-facing international consultation link generator.
//
// Mirrors the proven U.S. `create-enrollment` contract (shared secret OR HMAC,
// same header names) but uses a SEPARATE international secret and never
// touches U.S. enrollment tables.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { rejectExpiryOverride } from "../_shared/intl-expiry.ts";
import { createIntlConsultation } from "../_shared/intl-consultation-service.ts";
import { sendConsultationLink } from "../_shared/intl-send-link.ts";
import { addZohoNote, logIntegration, writeConsultationToZoho } from "../_shared/intl-zoho.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-intl-shared-secret, x-hmac-signature, x-hmac-timestamp",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function hmacSha256(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function header(headers: Headers, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [k, v] of headers.entries()) if (k.toLowerCase() === lower) return v;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const secret = Deno.env.get("INTL_ZOHO_SHARED_SECRET");
    if (!secret) return json({ error: "INTL_ZOHO_SHARED_SECRET is not configured" }, 500);

    const bodyText = await req.text();
    const headerSecret = header(req.headers, "x-intl-shared-secret");
    const signature = header(req.headers, "x-hmac-signature");
    const timestamp = header(req.headers, "x-hmac-timestamp");

    let authenticated = false;
    if (headerSecret) {
      authenticated = timingSafeEqual(headerSecret, secret);
    } else if (signature && timestamp) {
      if (Date.now() - parseInt(timestamp, 10) > 300_000) {
        return json({ error: "Request timestamp expired" }, 401);
      }
      authenticated = timingSafeEqual(signature, await hmacSha256(`${timestamp}.${bodyText}`, secret));
    }

    if (!authenticated) {
      await logIntegration(admin, {
        integration: "intl_zoho_create",
        direction: "inbound",
        error: "unauthorized",
        responseStatus: 401,
      });
      return json({ error: "Unauthorized" }, 401);
    }

    const body = JSON.parse(bodyText) as Record<string, unknown>;

    const amountMinor =
      body.amount_minor !== undefined
        ? Number(body.amount_minor)
        : body.amount !== undefined
          ? Math.round(Number(body.amount) * 100)
          : null;

    const result = await createIntlConsultation(admin, {
      surgeonId: body.surgeon_id ? String(body.surgeon_id) : null,
      zohoSurgeonId: body.zoho_surgeon_id
        ? String(body.zoho_surgeon_id)
        : body.surgeon_zoho_id
          ? String(body.surgeon_zoho_id)
          : null,
      patientName: String(body.patient_name ?? ""),
      patientEmail: body.patient_email ? String(body.patient_email) : null,
      patientPhone: body.patient_phone ? String(body.patient_phone) : null,
      language: body.language ? String(body.language) : body.preferred_language ? String(body.preferred_language) : null,
      amountMinor,
      currency: body.currency ? String(body.currency) : null,
      provider: body.provider ? String(body.provider) : null,
      policyId: body.policy_id ? String(body.policy_id) : null,
      notes: body.notes ? String(body.notes) : null,
      zohoModule: body.zoho_module ? String(body.zoho_module) : null,
      zohoRecordId: body.zoho_record_id ? String(body.zoho_record_id) : null,
      agentEmail: body.owner_email ? String(body.owner_email) : null,
      agentZohoId: body.owner_zoho_id ? String(body.owner_zoho_id) : null,
      actorType: "zoho",
      actorEmail: body.owner_email ? String(body.owner_email) : null,
    });

    if (!result.ok) {
      await logIntegration(admin, {
        integration: "intl_zoho_create",
        direction: "inbound",
        entityType: body.zoho_module ? String(body.zoho_module) : null ?? undefined,
        entityId: body.zoho_record_id ? String(body.zoho_record_id) : null,
        requestSummary: { patient_email: body.patient_email ?? null },
        error: result.error,
        responseStatus: result.status,
      });
      return json({ error: result.error }, result.status);
    }

    // Initial email — a send failure must not lose the created link.
    const send = await sendConsultationLink(admin, result.consultationId, "initial_link", {
      type: "zoho",
      email: body.owner_email ? String(body.owner_email) : null,
    });

    // CRM writeback (inline, with the outbox as the retry safety net).
    let zohoSynced = false;
    if (body.zoho_module && body.zoho_record_id) {
      try {
        await writeConsultationToZoho({
          module: String(body.zoho_module),
          recordId: String(body.zoho_record_id),
          paymentUrl: result.paymentUrl,
          expiresAt: result.expiresAt,
          tokenLast4: result.tokenLast4,
          paymentStatus: send.ok ? "link_sent" : "link_created",
          amountMinor: result.amountMinor,
          currency: result.currency,
          provider: result.provider,
          surgeonName: result.surgeon.name,
          country: result.surgeon.country,
          policyVersion: result.policy.version,
        });
        await addZohoNote(
          String(body.zoho_module),
          String(body.zoho_record_id),
          "Consultation payment link created",
          [
            `Link: ${result.paymentUrl}`,
            `Token: ****${result.tokenLast4}`,
            `Expires: ${result.expiresAt}`,
            `Surgeon: ${result.surgeon.name} (${result.surgeon.country})`,
            `Amount: ${result.amountMinor / 100} ${result.currency}`,
            `Provider: ${result.provider}`,
            `Policy: ${result.policy.version} (${result.policy.rule})`,
            `Email: ${send.ok ? "sent" : `not sent — ${send.error ?? send.suppressed}`}`,
          ].join("\n"),
        );
        zohoSynced = true;
      } catch (e) {
        await admin.from("intl_zoho_outbox").insert({
          consultation_id: result.consultationId,
          operation: "upsert_consultation",
          payload: { consultation_id: result.consultationId, payment_status: "link_created" },
          status: "pending",
          last_error: e instanceof Error ? e.message : "zoho writeback failed",
        });
      }
    }

    await logIntegration(admin, {
      integration: "intl_zoho_create",
      direction: "inbound",
      entityType: body.zoho_module ? String(body.zoho_module) : undefined,
      entityId: body.zoho_record_id ? String(body.zoho_record_id) : null,
      requestSummary: { consultation_id: result.consultationId, reused: result.reused },
      responseStatus: 200,
    });

    return json({
      success: true,
      consultation_id: result.consultationId,
      consultation_url: result.paymentUrl,
      token_last4: result.tokenLast4,
      expires_at: result.expiresAt,
      amount_minor: result.amountMinor,
      currency: result.currency,
      provider: result.provider,
      surgeon: result.surgeon,
      policy_version: result.policy.version,
      policy_rule: result.policy.rule,
      reused_existing_invitation: result.reused,
      email_sent: send.ok,
      email_error: send.ok ? null : (send.error ?? send.suppressed ?? null),
      zoho_synced: zohoSynced,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    await logIntegration(admin, {
      integration: "intl_zoho_create",
      direction: "inbound",
      error: message,
      responseStatus: 500,
    });
    return json({ error: message }, 500);
  }
});
