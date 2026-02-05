import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Secure endpoint to fetch enrollment data by token.
 * This replaces direct database queries from the frontend.
 * Only returns non-sensitive fields needed for the enrollment page.
 */

async function sha256Hash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

interface EnrollmentResponse {
  id: string;
  patient_first_name: string | null;
  patient_name: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  surgeon_name: string | null;
  amount_cents: number;
  currency: string | null;
  status: string;
  expires_at: string;
  terms_version: string;
  terms_url: string;
  privacy_url: string;
  terms_text: string | null;
  privacy_text: string | null;
  terms_sha256: string;
  opened_at: string | null;
  terms_accepted_at: string | null;
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

  try {
    const body = await req.json();
    const { token } = body;

    if (!token || typeof token !== "string") {
      return new Response(JSON.stringify({ error: "Token is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hash the token to look up the enrollment
    const tokenHash = await sha256Hash(token);

    // Fetch enrollment using service role (bypasses RLS)
    // Join with policies table and patients table (for surgeon)
    const { data: enrollment, error: fetchError } = await supabase
      .from("enrollments")
      .select(`
        id,
        patient_name,
        patient_email,
        patient_phone,
        patient_id,
        amount_cents,
        currency,
        status,
        expires_at,
        terms_version,
        terms_url,
        privacy_url,
        terms_sha256,
        opened_at,
        terms_accepted_at,
        policy_id,
        policies (
          terms_text,
          privacy_text
        )
      `)
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (fetchError) {
      console.error("Database error:", fetchError);
      return new Response(JSON.stringify({ error: "Database error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!enrollment) {
      return new Response(JSON.stringify({ error: "Enrollment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if expired by time and update status if needed
    const now = new Date();
    const expiresAt = new Date(enrollment.expires_at);
    
    if (expiresAt < now && enrollment.status !== 'expired' && enrollment.status !== 'paid' && enrollment.status !== 'processing') {
      // Update to expired status
      await supabase
        .from("enrollments")
        .update({ 
          status: 'expired',
          expired_at: now.toISOString()
        })
        .eq("id", enrollment.id);
      
      enrollment.status = 'expired';
    }

    // Mark as opened if first view and not already in a terminal state
    if (!enrollment.opened_at && ['created', 'sent'].includes(enrollment.status)) {
      const openedAt = now.toISOString();
      await supabase
        .from("enrollments")
        .update({ 
          opened_at: openedAt,
          status: 'opened'
        })
        .eq("id", enrollment.id);

      // Log the opened event
      await supabase.from("enrollment_events").insert({
        enrollment_id: enrollment.id,
        event_type: "opened",
        event_data: {
          timestamp: openedAt,
        },
      });

      enrollment.opened_at = openedAt;
      enrollment.status = 'opened';
    }

    // Return only non-sensitive data
    // Extract first name only for privacy
    const patientFirstName = enrollment.patient_name 
      ? enrollment.patient_name.split(' ')[0] 
      : null;

    // Get policy text (from joined policies table)
    const policyData = (enrollment as any).policies;
    
    // Fetch surgeon name if patient has one
    let surgeonName: string | null = null;
    if (enrollment.patient_id) {
      const { data: patientData } = await supabase
        .from("patients")
        .select("surgeon_id, surgeon:surgeons(name)")
        .eq("id", enrollment.patient_id)
        .maybeSingle();
      
      if (patientData && (patientData as any).surgeon) {
        surgeonName = (patientData as any).surgeon.name;
      }
    }
    
    const response: EnrollmentResponse = {
      id: enrollment.id,
      patient_first_name: patientFirstName,
      patient_name: enrollment.patient_name,
      patient_email: enrollment.patient_email,
      patient_phone: enrollment.patient_phone,
      surgeon_name: surgeonName,
      amount_cents: enrollment.amount_cents,
      currency: enrollment.currency,
      status: enrollment.status,
      expires_at: enrollment.expires_at,
      terms_version: enrollment.terms_version,
      terms_url: enrollment.terms_url,
      privacy_url: enrollment.privacy_url,
      terms_text: policyData?.terms_text || null,
      privacy_text: policyData?.privacy_text || null,
      terms_sha256: enrollment.terms_sha256,
      opened_at: enrollment.opened_at,
      terms_accepted_at: enrollment.terms_accepted_at,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in get-enrollment:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Internal server error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
