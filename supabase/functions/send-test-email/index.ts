import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
    const { email } = await req.json();
    const targetEmail = email || "ray@himplant.com";

    await sendConfirmationEmail({
      patientName: "Test Patient",
      patientEmail: targetEmail,
      amountCents: 150000,
      currency: "usd",
      paymentMethodType: "card",
      paymentDate: new Date().toISOString(),
      pdfBytes: null, // No PDF for test
      enrollmentId: "test-123",
    });

    return new Response(JSON.stringify({ success: true, sent_to: targetEmail }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error sending test email:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
