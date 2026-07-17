import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { sendConfirmationEmail } from "../_shared/send-confirmation-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // SECURITY: require admin + AAL2 (MFA) — this endpoint sends real email from our domain
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: adminUser } = await supabase
      .from("admin_users").select("id").eq("user_id", user.id)
      .not("accepted_at", "is", null).maybeSingle();
    if (!adminUser) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: aal } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal || aal.currentLevel !== "aal2") {
      return new Response(JSON.stringify({ error: "MFA required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email } = await req.json().catch(() => ({}));
    const targetEmail = email || "ray@himplant.com";

    // Fetch a real paid enrollment with a consent PDF
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("*")
      .eq("status", "paid")
      .not("consent_pdf_path", "is", null)
      .limit(1)
      .single();

    let pdfBytes: Uint8Array | null = null;
    if (enrollment?.consent_pdf_path) {
      const { data: fileData, error } = await supabase.storage
        .from("consent-documents")
        .download(enrollment.consent_pdf_path);
      if (fileData && !error) {
        pdfBytes = new Uint8Array(await fileData.arrayBuffer());
        console.log(`Loaded PDF: ${enrollment.consent_pdf_path} (${pdfBytes.length} bytes)`);
      } else {
        console.error("Failed to download PDF:", error);
      }
    }

    await sendConfirmationEmail({
      patientName: enrollment?.patient_name || "Test Patient",
      patientEmail: targetEmail,
      amountCents: enrollment?.amount_cents || 150000,
      currency: enrollment?.currency || "usd",
      paymentMethodType: enrollment?.payment_method_type || "card",
      paymentDate: enrollment?.paid_at || new Date().toISOString(),
      pdfBytes,
      enrollmentId: enrollment?.id || "test-123",
    });

    return new Response(JSON.stringify({ success: true, sent_to: targetEmail, has_pdf: !!pdfBytes }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error sending test email:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
