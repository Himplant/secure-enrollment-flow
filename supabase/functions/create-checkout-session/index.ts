import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import Stripe from "npm:stripe@18.5.0";
// PDF generation has been moved to stripe-webhook for accurate payment-date timestamps

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CheckoutRequest {
  token: string;
  terms_accepted: boolean;
  consent_ip?: string;
  consent_user_agent?: string;
  signature_data?: string;
}

async function sha256Hash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

// HTML stripping and PDF generation moved to shared module in stripe-webhook

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }

    const body: CheckoutRequest = await req.json();

    if (!body.token) {
      return new Response(JSON.stringify({ error: "Token is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.terms_accepted) {
      return new Response(JSON.stringify({ error: "Terms must be accepted" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hash the token to find the enrollment
    const tokenHash = await sha256Hash(body.token);

    // Fetch enrollment by token hash (with policy text)
    const { data: enrollment, error: fetchError } = await supabase
      .from("enrollments")
      .select(`
        *,
        policies (
          terms_text,
          privacy_text
        )
      `)
      .eq("token_hash", tokenHash)
      .single();

    if (fetchError || !enrollment) {
      return new Response(JSON.stringify({ error: "Invalid or expired enrollment link" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if already paid
    if (enrollment.status === "paid") {
      return new Response(JSON.stringify({ error: "This enrollment has already been paid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if expired
    if (new Date(enrollment.expires_at) < new Date()) {
      if (enrollment.status !== "expired") {
        await supabase
          .from("enrollments")
          .update({ status: "expired", expired_at: new Date().toISOString() })
          .eq("id", enrollment.id);
      }
      return new Response(JSON.stringify({ error: "This enrollment link has expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if canceled
    if (enrollment.status === "canceled") {
      return new Response(JSON.stringify({ error: "This enrollment has been canceled" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record terms acceptance
    // SECURITY: Always use server-side IP, never trust client-provided value
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = req.headers.get("user-agent") || body.consent_user_agent || "unknown";

    // Note: Consent PDF is now generated in the stripe-webhook handler
    // when payment is confirmed, so the timestamp matches the payment date.

    // Update enrollment with consent data
    await supabase
      .from("enrollments")
      .update({
        terms_accepted_at: new Date().toISOString(),
        terms_accept_ip: clientIp,
        terms_accept_user_agent: userAgent,
        signature_data: body.signature_data || null,
      })
      .eq("id", enrollment.id);

    // Log terms acceptance event
    await supabase.from("enrollment_events").insert({
      enrollment_id: enrollment.id,
      event_type: "terms_accepted",
      event_data: {
        ip: clientIp,
        user_agent: userAgent,
        terms_version: enrollment.terms_version,
        has_signature: !!body.signature_data,
      },
    });

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Calculate session expiration
    const enrollmentExpiry = new Date(enrollment.expires_at);
    const thirtyMinutesFromNow = new Date(Date.now() + 30 * 60 * 1000);
    const sessionExpiry = enrollmentExpiry < thirtyMinutesFromNow ? enrollmentExpiry : thirtyMinutesFromNow;
    const minExpiryTime = new Date(Date.now() + 30 * 60 * 1000);
    const stripeExpiresAt = Math.max(
      Math.floor(sessionExpiry.getTime() / 1000),
      Math.floor(minExpiryTime.getTime() / 1000)
    );

    // Check if customer exists or create one
    let customerId: string | undefined;
    if (enrollment.patient_email) {
      const customers = await stripe.customers.list({ 
        email: enrollment.patient_email, 
        limit: 1 
      });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: enrollment.patient_email,
          name: enrollment.patient_name || undefined,
          phone: enrollment.patient_phone || undefined,
          metadata: {
            zoho_record_id: enrollment.zoho_record_id,
            zoho_module: enrollment.zoho_module,
          },
        });
        customerId = customer.id;
      }
    }

    // Get base URL for redirects
    const appUrl = (Deno.env.get("APP_URL") || req.headers.get("origin") || "https://secure-enrollment-flow.lovable.app").replace(/\/+$/, "");

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : enrollment.patient_email || undefined,
      payment_method_types: ["card", "us_bank_account"],
      billing_address_collection: "required",
      line_items: [
        {
          price_data: {
            currency: enrollment.currency || "usd",
            product_data: {
              name: "Medical Service Enrollment",
              description: `Enrollment payment for ${enrollment.patient_name || "Patient"}`,
            },
            unit_amount: enrollment.amount_cents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${appUrl}/enroll/${body.token}?status=success`,
      cancel_url: `${appUrl}/enroll/${body.token}?status=canceled`,
      expires_at: stripeExpiresAt,
      metadata: {
        enrollment_id: enrollment.id,
        zoho_record_id: enrollment.zoho_record_id,
        zoho_module: enrollment.zoho_module,
        terms_version: enrollment.terms_version,
        terms_sha256: enrollment.terms_sha256,
      },
      payment_intent_data: {
        metadata: {
          enrollment_id: enrollment.id,
          zoho_record_id: enrollment.zoho_record_id,
          zoho_module: enrollment.zoho_module,
        },
      },
    });

    // Update enrollment with Stripe session info
    await supabase
      .from("enrollments")
      .update({
        stripe_session_id: session.id,
        stripe_customer_id: customerId || null,
      })
      .eq("id", enrollment.id);

    // Log checkout session created event
    await supabase.from("enrollment_events").insert({
      enrollment_id: enrollment.id,
      event_type: "checkout_session_created",
      event_data: {
        session_id: session.id,
        customer_id: customerId,
        amount_cents: enrollment.amount_cents,
      },
    });

    console.log(`Created checkout session ${session.id} for enrollment ${enrollment.id}`);

    return new Response(JSON.stringify({
      success: true,
      checkout_url: session.url,
      session_id: session.id,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in create-checkout-session:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Internal server error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
