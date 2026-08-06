// Creates the provider checkout for a consultation link.
// The checkout is always created against the surgeon's own connected merchant
// account — money settles directly to the surgeon, never to Himplant.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireIntlEnabled } from "../_shared/flags.ts";
import { hashConsultationToken } from "../_shared/intl-token.ts";
import { getProvider } from "../_shared/providers/registry.ts";
import { requirePolicySnapshot } from "../_shared/intl-policy.ts";
import { isExpired, persistExpiryIfNeeded } from "../_shared/intl-expiry.ts";

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
    const body = await req.json().catch(() => null) as
      | { token?: string; accepted_terms?: boolean; signature_data?: string }
      | null;
    const token = body?.token?.trim();
    if (!token || token.length < 16) return json({ error: "Invalid link" }, 400);
    if (!body?.accepted_terms) return json({ error: "Terms must be accepted" }, 400);

    // Consent signature is mandatory, exactly as in U.S. SecurePay.
    const signature = typeof body?.signature_data === "string" ? body.signature_data.trim() : "";
    if (!signature.startsWith("data:image/") || signature.length < 200) {
      return json({ error: "A signature is required to continue" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const tokenHash = await hashConsultationToken(token);
    const { data: c } = await admin
      .from("consultations")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!c) return json({ error: "Link not found" }, 404);

    const flagBlock = await requireIntlEnabled({
      country: c.country as string,
      provider: c.provider as string,
    });
    if (flagBlock) return flagBlock;

    if (c.payment_status === "approved") return json({ error: "Already paid" }, 409);
    if (isExpired(c.expires_at as string)) {
      await persistExpiryIfNeeded(admin, {
        id: c.id as string,
        expires_at: c.expires_at as string,
        payment_status: c.payment_status as string,
        expired_at: c.expired_at as string | null,
      });
      return json({ error: "This payment link has expired" }, 410);
    }
    if (["canceled", "refunded", "disputed"].includes(c.payment_status as string)) {
      return json({ error: "This payment link is no longer active" }, 409);
    }

    // Re-verify the recipient account is still connected at payment time.
    const { data: account } = await admin
      .from("provider_accounts")
      .select("id, provider, external_merchant_id, status, is_active, environment")
      .eq("id", c.provider_account_id)
      .maybeSingle();

    if (!account || account.status !== "connected" || !account.is_active) {
      return json({ error: "The surgeon's payment account is currently unavailable" }, 409);
    }

    const provider = getProvider(c.provider as string);
    if (!provider) return json({ error: "Payment provider unavailable" }, 503);

    // Fail closed: no immutable policy snapshot means no checkout.
    if (!(await requirePolicySnapshot(admin, c.id as string))) {
      return json({ error: "This consultation has no accepted policy on record" }, 409);
    }

    const { data: snapshot } = await admin
      .from("consultation_policy_snapshots")
      .select("id, policy_version, content_sha256")
      .eq("consultation_id", c.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const [{ data: patient }, { data: surgeonRec }] = await Promise.all([
      admin.from("consultation_patients").select("full_name, email").eq("id", c.patient_id).maybeSingle(),
      admin.from("surgeons").select("name").eq("id", c.surgeon_id).maybeSingle(),
    ]);

    const appUrl = Deno.env.get("APP_URL") ?? "";
    const checkout = await provider.createCheckout({
      consultationId: c.id as string,
      recipientMerchantId: account.external_merchant_id as string | null,
      providerAccountId: account.id as string,
      amountMinor: Number(c.amount_minor),
      currency: String(c.currency),
      country: String(c.country),
      description: `Consultation — ${surgeonRec?.name ?? "Consultation"}`,
      payerEmail: patient?.email ?? null,
      payerName: patient?.full_name ?? null,
      successUrl: `${appUrl}/consult/${token}/success`,
      pendingUrl: `${appUrl}/consult/${token}/pending`,
      failureUrl: `${appUrl}/consult/${token}?failed=1`,
      environment: (account.environment as "sandbox" | "live") ?? "sandbox",
      expiresAt: c.expires_at as string,
    });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    await admin
      .from("consultations")
      .update({
        payment_status: "processing",
        provider_checkout_url: checkout.checkoutUrl,
        provider_order_id: checkout.providerOrderId,
        provider_payment_id: checkout.providerPaymentId,
        terms_accepted_at: new Date().toISOString(),
        terms_accept_ip: ip,
        terms_accept_user_agent: req.headers.get("user-agent"),
        signature_data: signature,
        policy_snapshot_id: snapshot?.id ?? c.policy_snapshot_id,
        terms_version: snapshot?.policy_version ?? c.terms_version,
        terms_sha256: snapshot?.content_sha256 ?? c.terms_sha256,
      })
      .eq("id", c.id);

    // Every attempt is preserved; consultation columns stay a latest-summary.
    await admin.from("consultation_payment_attempts").insert({
      consultation_id: c.id,
      provider: c.provider,
      provider_order_id: checkout.providerOrderId,
      provider_payment_id: checkout.providerPaymentId,
      checkout_url: checkout.checkoutUrl,
      amount_minor: Number(c.amount_minor),
      currency: String(c.currency),
      status: "processing",
    });

    await admin.from("consultation_events").insert({
      consultation_id: c.id,
      event_type: "terms_accepted",
      event_data: {
        policy_snapshot_id: snapshot?.id ?? null,
        policy_version: snapshot?.policy_version ?? null,
        content_sha256: snapshot?.content_sha256 ?? null,
        signed: true,
        ip,
      },
      actor_type: "patient",
    });

    await admin.from("consultation_events").insert({
      consultation_id: c.id,
      event_type: "checkout_created",
      event_data: { provider: c.provider, order_id: checkout.providerOrderId },
      actor_type: "patient",
    });

    return json({ checkout_url: checkout.checkoutUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
