import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import Stripe from "npm:stripe@18.5.0";
import { generateConsentPdf } from "../_shared/consent-pdf.ts";
import { sendConfirmationEmail } from "../_shared/send-confirmation-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

// Helper to refresh Zoho access token
async function getZohoAccessToken(): Promise<string> {
  const refreshToken = Deno.env.get("ZOHO_REFRESH_TOKEN");
  const clientId = Deno.env.get("ZOHO_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Zoho credentials not configured");
  }

  const response = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to refresh Zoho token: ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

// Update Zoho CRM record
async function updateZohoRecord(
  module: string,
  recordId: string,
  data: Record<string, unknown>
): Promise<void> {
  const accessToken = await getZohoAccessToken();

  const response = await fetch(
    `https://www.zohoapis.com/crm/v6/${module}/${recordId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: [data] }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to update Zoho record: ${errorText}`);
    // Don't throw - we don't want to fail the webhook if Zoho update fails
  } else {
    console.log(`Updated Zoho ${module}/${recordId}`);
  }
}

// Add note to Zoho CRM record
async function addZohoNote(
  module: string,
  recordId: string,
  title: string,
  content: string
): Promise<void> {
  const accessToken = await getZohoAccessToken();

  const response = await fetch("https://www.zohoapis.com/crm/v6/Notes", {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: [
        {
          Parent_Id: recordId,
          se_module: module,
          Note_Title: title,
          Note_Content: content,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to add Zoho note: ${errorText}`);
  }
}

// Generate and store consent PDF when payment is confirmed
async function generateAndStoreConsentPdf(
  supabase: any,
  enrollment: any,
  paymentDate: string,
): Promise<Uint8Array | null> {
  try {
    // Fetch policy text
    const { data: policy } = enrollment.policy_id
      ? await supabase.from("policies").select("terms_text, privacy_text").eq("id", enrollment.policy_id).single()
      : { data: null };

    // Decode signature if stored
    let signaturePngBytes: Uint8Array | null = null;
    if (enrollment.signature_data && enrollment.signature_data !== "stored") {
      const base64Match = enrollment.signature_data.match(/^data:image\/png;base64,(.+)$/);
      if (base64Match) {
        const binaryString = atob(base64Match[1]);
        signaturePngBytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          signaturePngBytes[i] = binaryString.charCodeAt(i);
        }
      }
    }

    const pdfBytes = await generateConsentPdf(
      enrollment,
      policy?.terms_text || null,
      policy?.privacy_text || null,
      signaturePngBytes,
      enrollment.terms_accept_ip || "unknown",
      enrollment.terms_accept_user_agent || "unknown",
      paymentDate,
    );

    const pdfFileName = `${enrollment.id}/${Date.now()}-consent.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("consent-documents")
      .upload(pdfFileName, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("Error uploading consent PDF:", uploadError);
      return pdfBytes; // Still return bytes for email even if upload fails
    }

    await supabase
      .from("enrollments")
      .update({ consent_pdf_path: pdfFileName })
      .eq("id", enrollment.id);

    console.log(`Consent PDF generated and stored: ${pdfFileName}`);
    return pdfBytes;
  } catch (err) {
    console.error("Error generating consent PDF:", err);
    return null;
  }
}

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

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!stripeKey) {
    console.error("STRIPE_SECRET_KEY not configured");
    return new Response(JSON.stringify({ error: "Stripe not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    let event: Stripe.Event;

    // SECURITY: Always require webhook signature verification
    // This prevents attackers from sending fake payment events
    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET not configured");
      return new Response(JSON.stringify({ error: "Webhook not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!signature) {
      console.error("Missing stripe-signature header");
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for duplicate event processing (idempotency)
    const { data: existingEvent } = await supabase
      .from("processed_stripe_events")
      .select("stripe_event_id")
      .eq("stripe_event_id", event.id)
      .single();

    if (existingEvent) {
      console.log(`Event ${event.id} already processed, skipping`);
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing Stripe event: ${event.type} (${event.id})`);

    // Handle different event types
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const enrollmentId = session.metadata?.enrollment_id;

        if (!enrollmentId) {
          console.log("No enrollment_id in session metadata, skipping");
          break;
        }

        // Get payment method type
        const paymentMethodType = session.payment_method_types?.[0] === "us_bank_account" ? "ach" : "card";

        // Determine status based on payment method
        // ACH payments may still be processing, card payments are immediate
        const newStatus = paymentMethodType === "ach" ? "processing" : "paid";
        const paidAt = newStatus === "paid" ? new Date().toISOString() : null;

        // Update enrollment
        const { data: enrollment, error: updateError } = await supabase
          .from("enrollments")
          .update({
            status: newStatus,
            payment_method_type: paymentMethodType,
            stripe_payment_intent_id: session.payment_intent as string,
            paid_at: paidAt,
          })
          .eq("id", enrollmentId)
          .select()
          .single();

        if (updateError) {
          console.error("Failed to update enrollment:", updateError);
          break;
        }

        // Log event
        await supabase.from("enrollment_events").insert({
          enrollment_id: enrollmentId,
          event_type: "checkout_completed",
          event_data: {
            session_id: session.id,
            payment_intent_id: session.payment_intent,
            payment_method_type: paymentMethodType,
            status: newStatus,
          },
        });

        // Update Zoho CRM
        if (enrollment) {
          await updateZohoRecord(enrollment.zoho_module, enrollment.zoho_record_id, {
            Enrollment_Status: newStatus === "paid" ? "Paid" : "Processing",
            Payment_Method_Stripe: paymentMethodType === "ach" ? "ACH" : "Card",
            Stripe_Session_ID: session.id,
            ...(newStatus === "paid" && { Payment_Date: new Date().toISOString() }),
            ...(newStatus === "processing" && { Processing_Date: new Date().toISOString() }),
          });

          await addZohoNote(
            enrollment.zoho_module,
            enrollment.zoho_record_id,
            newStatus === "paid" ? "Payment Completed" : "Payment Processing",
            `Enrollment payment ${newStatus === "paid" ? "completed" : "initiated"} via ${paymentMethodType.toUpperCase()}. Amount: $${(enrollment.amount_cents / 100).toFixed(2)}`
          );
        }

        // Generate consent PDF with payment date timestamp
        if (enrollment && newStatus === "paid") {
          const pdfBytes = await generateAndStoreConsentPdf(supabase, enrollment, paidAt!);
          await sendConfirmationEmail({
            patientName: enrollment.patient_name || "Valued Patient",
            patientEmail: enrollment.patient_email,
            amountCents: enrollment.amount_cents,
            currency: enrollment.currency || "usd",
            paymentMethodType: paymentMethodType,
            paymentDate: paidAt!,
            pdfBytes: pdfBytes,
            enrollmentId: enrollment.id,
          });
        }

        console.log(`Enrollment ${enrollmentId} updated to ${newStatus}`);
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const enrollmentId = paymentIntent.metadata?.enrollment_id;

        if (!enrollmentId) {
          console.log("No enrollment_id in payment intent metadata, skipping");
          break;
        }

        // This handles ACH payments that complete after checkout
        const { data: enrollment, error: updateError } = await supabase
          .from("enrollments")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
          })
          .eq("id", enrollmentId)
          .eq("status", "processing") // Only update if currently processing
          .select()
          .single();

        if (updateError && updateError.code !== "PGRST116") {
          console.error("Failed to update enrollment:", updateError);
          break;
        }

        if (enrollment) {
          // Log event
          await supabase.from("enrollment_events").insert({
            enrollment_id: enrollmentId,
            event_type: "payment_succeeded",
            event_data: {
              payment_intent_id: paymentIntent.id,
              amount: paymentIntent.amount,
            },
          });

          // Update Zoho CRM
          await updateZohoRecord(enrollment.zoho_module, enrollment.zoho_record_id, {
            Enrollment_Status: "Paid",
            Payment_Date: new Date().toISOString(),
          });

          await addZohoNote(
            enrollment.zoho_module,
            enrollment.zoho_record_id,
            "Payment Confirmed",
            `ACH payment confirmed. Amount: $${(enrollment.amount_cents / 100).toFixed(2)}`
          );

          // Generate consent PDF with payment date
          const pdfBytes = await generateAndStoreConsentPdf(supabase, enrollment, enrollment.paid_at);
          await sendConfirmationEmail({
            patientName: enrollment.patient_name || "Valued Patient",
            patientEmail: enrollment.patient_email,
            amountCents: enrollment.amount_cents,
            currency: enrollment.currency || "usd",
            paymentMethodType: "ach",
            paymentDate: enrollment.paid_at,
            pdfBytes: pdfBytes,
            enrollmentId: enrollment.id,
          });

          console.log(`Enrollment ${enrollmentId} payment confirmed`);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const enrollmentId = paymentIntent.metadata?.enrollment_id;

        if (!enrollmentId) {
          console.log("No enrollment_id in payment intent metadata, skipping");
          break;
        }

        const { data: enrollment, error: updateError } = await supabase
          .from("enrollments")
          .update({
            status: "failed",
            failed_at: new Date().toISOString(),
          })
          .eq("id", enrollmentId)
          .select()
          .single();

        if (updateError) {
          console.error("Failed to update enrollment:", updateError);
          break;
        }

        if (enrollment) {
          // Log event
          await supabase.from("enrollment_events").insert({
            enrollment_id: enrollmentId,
            event_type: "payment_failed",
            event_data: {
              payment_intent_id: paymentIntent.id,
              error: paymentIntent.last_payment_error?.message,
            },
          });

          // Update Zoho CRM
          await updateZohoRecord(enrollment.zoho_module, enrollment.zoho_record_id, {
            Enrollment_Status: "Failed",
            Payment_Failed_Date: new Date().toISOString(),
          });

          await addZohoNote(
            enrollment.zoho_module,
            enrollment.zoho_record_id,
            "Payment Failed",
            `Payment failed: ${paymentIntent.last_payment_error?.message || "Unknown error"}`
          );

          console.log(`Enrollment ${enrollmentId} payment failed`);
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const enrollmentId = session.metadata?.enrollment_id;

        if (!enrollmentId) {
          console.log("No enrollment_id in session metadata, skipping");
          break;
        }

        const { data: enrollment, error: updateError } = await supabase
          .from("enrollments")
          .update({
            status: "expired",
            expired_at: new Date().toISOString(),
          })
          .eq("id", enrollmentId)
          .eq("status", "processing") // Only update if currently processing
          .select()
          .single();

        if (updateError && updateError.code !== "PGRST116") {
          console.error("Failed to update enrollment:", updateError);
          break;
        }

        if (enrollment) {
          // Log event
          await supabase.from("enrollment_events").insert({
            enrollment_id: enrollmentId,
            event_type: "checkout_expired",
            event_data: {
              session_id: session.id,
            },
          });

          // Update Zoho CRM
          await updateZohoRecord(enrollment.zoho_module, enrollment.zoho_record_id, {
            Enrollment_Status: "Expired",
            Expired_Date: new Date().toISOString(),
          });

          await addZohoNote(
            enrollment.zoho_module,
            enrollment.zoho_record_id,
            "Checkout Expired",
            "Stripe checkout session expired without payment"
          );

          console.log(`Enrollment ${enrollmentId} checkout expired`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Record that we processed this event (idempotency)
    await supabase.from("processed_stripe_events").insert({
      stripe_event_id: event.id,
    });

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in stripe-webhook:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Internal server error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
