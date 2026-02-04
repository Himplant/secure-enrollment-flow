import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AdminEnrollmentRequest {
  patient_name: string;
  patient_email?: string;
  patient_phone?: string;
  patient_id?: string;
  policy_id?: string;
  amount_cents: number;
  currency?: string;
  expires_at: string; // ISO timestamp
}

function generateSecureToken(length = 32): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
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

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Supabase client with user's auth token
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user is an admin
    const { data: adminUser, error: adminError } = await supabase
      .from("admin_users")
      .select("id, role")
      .eq("user_id", user.id)
      .not("accepted_at", "is", null)
      .maybeSingle();

    if (adminError || !adminUser) {
      return new Response(JSON.stringify({ error: "Only admins can create enrollments" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: AdminEnrollmentRequest = await req.json();

    // Validate required fields
    if (!body.patient_name || !body.amount_cents || !body.expires_at) {
      return new Response(JSON.stringify({ 
        error: "Missing required fields",
        required: ["patient_name", "amount_cents", "expires_at"]
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate expiration date is in the future
    const expiresAt = new Date(body.expires_at);
    if (expiresAt <= new Date()) {
      return new Response(JSON.stringify({ error: "Expiration date must be in the future" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate secure token
    const rawToken = generateSecureToken(32);
    const tokenHash = await sha256Hash(rawToken);
    const tokenLast4 = rawToken.slice(-4);

    // Use service role for insertion
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get policy details (either specified or default)
    let policy;
    if (body.policy_id) {
      const { data, error } = await supabaseAdmin
        .from("policies")
        .select("*")
        .eq("id", body.policy_id)
        .eq("is_active", true)
        .single();
      
      if (error || !data) {
        return new Response(JSON.stringify({ error: "Selected policy not found or inactive" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      policy = data;
    } else {
      // Get default policy
      const { data, error } = await supabaseAdmin
        .from("policies")
        .select("*")
        .eq("is_default", true)
        .eq("is_active", true)
        .single();
      
      if (error || !data) {
        return new Response(JSON.stringify({ error: "No default policy found. Please create a policy first." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      policy = data;
    }

    // Create enrollment record with policy reference
    const { data: enrollment, error: insertError } = await supabaseAdmin
      .from("enrollments")
      .insert({
        zoho_record_id: `manual_${Date.now()}`, // Placeholder for manual enrollments
        zoho_module: "manual",
        patient_name: body.patient_name,
        patient_email: body.patient_email || null,
        patient_phone: body.patient_phone || null,
        patient_id: body.patient_id || null,
        policy_id: policy.id,
        amount_cents: body.amount_cents,
        currency: body.currency ?? "usd",
        terms_url: policy.terms_url,
        privacy_url: policy.privacy_url,
        terms_version: policy.version,
        terms_sha256: policy.terms_content_sha256,
        token_hash: tokenHash,
        token_last4: tokenLast4,
        expires_at: expiresAt.toISOString(),
        status: "created",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to create enrollment:", insertError);
      return new Response(JSON.stringify({ error: `Failed to create enrollment: ${insertError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log the created event
    await supabaseAdmin.from("enrollment_events").insert({
      enrollment_id: enrollment.id,
      event_type: "created",
      event_data: {
        source: "admin_dashboard",
        created_by: user.id,
        amount_cents: body.amount_cents,
        expires_at: expiresAt.toISOString(),
        policy_id: policy.id,
        policy_name: policy.name,
        policy_version: policy.version,
      },
    });

    // Build enrollment URL
    const appUrl = Deno.env.get("APP_URL") || req.headers.get("origin") || "https://secure-enrollment-flow.lovable.app";
    const enrollmentUrl = `${appUrl}/enroll/${rawToken}`;

    console.log(`Admin ${user.email} created enrollment ${enrollment.id}`);

    return new Response(JSON.stringify({
      success: true,
      enrollment_id: enrollment.id,
      enrollment_url: enrollmentUrl,
      expires_at: expiresAt.toISOString(),
      token_last4: tokenLast4,
    }), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in admin-create-enrollment:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Internal server error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
