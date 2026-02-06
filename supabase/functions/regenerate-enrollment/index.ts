import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RegenerateEnrollmentRequest {
  enrollment_id: string;
  expires_at: string; // ISO timestamp
  policy_id?: string; // Optional policy to attach
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
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
      return new Response(JSON.stringify({ error: "Only admins can regenerate enrollments" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: RegenerateEnrollmentRequest = await req.json();

    // Validate required fields
    if (!body.enrollment_id || !body.expires_at) {
      return new Response(JSON.stringify({ 
        error: "Missing required fields",
        required: ["enrollment_id", "expires_at"]
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

    // Use service role for database operations
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get existing enrollment
    const { data: existingEnrollment, error: fetchError } = await supabaseAdmin
      .from("enrollments")
      .select("*")
      .eq("id", body.enrollment_id)
      .single();

    if (fetchError || !existingEnrollment) {
      return new Response(JSON.stringify({ error: "Enrollment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if enrollment can be regenerated (cannot regenerate paid or processing enrollments)
    const nonRegeneratableStatuses = ['paid', 'processing'];
    if (nonRegeneratableStatuses.includes(existingEnrollment.status)) {
      return new Response(JSON.stringify({ 
        error: `Cannot regenerate enrollment with status '${existingEnrollment.status}'. Paid or processing enrollments cannot be regenerated.`
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate new secure token
    const rawToken = generateSecureToken(32);
    const tokenHash = await sha256Hash(rawToken);
    const tokenLast4 = rawToken.slice(-4);

    // If a policy_id is provided, fetch the policy to get terms info
    let policyData: {
      terms_url: string;
      privacy_url: string;
      terms_content_sha256: string;
      version: string;
    } | null = null;

    const policyIdToUse = body.policy_id || existingEnrollment.policy_id;

    if (policyIdToUse) {
      const { data: policy, error: policyError } = await supabaseAdmin
        .from("policies")
        .select("terms_url, privacy_url, terms_content_sha256, version")
        .eq("id", policyIdToUse)
        .eq("is_active", true)
        .maybeSingle();

      if (policyError) {
        console.error("Error fetching policy:", policyError);
      } else if (policy) {
        policyData = policy;
      }
    }

    // Update enrollment with new token and reset status
    const updateData: Record<string, unknown> = {
      token_hash: tokenHash,
      token_last4: tokenLast4,
      expires_at: expiresAt.toISOString(),
      status: "created",
      // Reset payment-related fields
      opened_at: null,
      processing_at: null,
      paid_at: null,
      failed_at: null,
      expired_at: null,
      terms_accepted_at: null,
      terms_accept_ip: null,
      terms_accept_user_agent: null,
      stripe_session_id: null,
      stripe_payment_intent_id: null,
      stripe_customer_id: null,
      payment_method_type: null,
    };

    // Update policy-related fields if we have a policy
    if (policyIdToUse) {
      updateData.policy_id = policyIdToUse;
    }
    if (policyData) {
      updateData.terms_url = policyData.terms_url;
      updateData.privacy_url = policyData.privacy_url;
      updateData.terms_sha256 = policyData.terms_content_sha256;
      updateData.terms_version = policyData.version;
    }

    const { data: updatedEnrollment, error: updateError } = await supabaseAdmin
      .from("enrollments")
      .update(updateData)
      .eq("id", body.enrollment_id)
      .select()
      .single();

    if (updateError) {
      console.error("Failed to regenerate enrollment:", updateError);
      return new Response(JSON.stringify({ error: `Failed to regenerate enrollment: ${updateError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log the regenerated event
    await supabaseAdmin.from("enrollment_events").insert({
      enrollment_id: body.enrollment_id,
      event_type: "regenerated",
      event_data: {
        source: "admin_dashboard",
        regenerated_by: user.id,
        previous_status: existingEnrollment.status,
        new_expires_at: expiresAt.toISOString(),
      },
    });

    // Build enrollment URL
    const appUrl = (Deno.env.get("APP_URL") || req.headers.get("origin") || "https://secure-enrollment-flow.lovable.app").replace(/\/+$/, "");
    const enrollmentUrl = `${appUrl}/enroll/${rawToken}`;

    console.log(`Admin ${user.email} regenerated enrollment ${body.enrollment_id}`);

    // Sync to Zoho CRM
    if (updatedEnrollment.zoho_record_id && updatedEnrollment.zoho_module) {
      try {
        const zohoAccessToken = await getZohoAccessToken();

        // Format expiry for Zoho (yyyy-MM-ddTHH:mm:ss+00:00)
        const pad = (n: number) => String(n).padStart(2, "0");
        const expiresAtFormatted = `${expiresAt.getFullYear()}-${pad(expiresAt.getMonth() + 1)}-${pad(expiresAt.getDate())}T${pad(expiresAt.getHours())}:${pad(expiresAt.getMinutes())}:${pad(expiresAt.getSeconds())}+00:00`;

        const zohoResponse = await fetch(
          `https://www.zohoapis.com/crm/v6/${updatedEnrollment.zoho_module}/${updatedEnrollment.zoho_record_id}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Zoho-oauthtoken ${zohoAccessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              data: [{
                Enrollment_Status: "created",
                Enrollment_Link: enrollmentUrl,
                Enrollment_Expires_At: expiresAtFormatted,
                Enrollment_Token_Last4: tokenLast4,
              }],
            }),
          }
        );

        if (!zohoResponse.ok) {
          console.error("Failed to update Zoho on regenerate:", await zohoResponse.text());
        } else {
          console.log(`Updated Zoho ${updatedEnrollment.zoho_module}/${updatedEnrollment.zoho_record_id} with regenerated link`);
        }

        // Add timeline note
        await fetch("https://www.zohoapis.com/crm/v6/Notes", {
          method: "POST",
          headers: {
            Authorization: `Zoho-oauthtoken ${zohoAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: [{
              Parent_Id: updatedEnrollment.zoho_record_id,
              se_module: updatedEnrollment.zoho_module,
              Note_Title: "Enrollment Link Regenerated",
              Note_Content: `Enrollment link was regenerated by admin. New link expires at ${expiresAt.toISOString()}. Previous status: ${existingEnrollment.status}.`,
            }],
          }),
        });
      } catch (zohoErr) {
        console.error("Zoho sync error on regenerate:", zohoErr);
        // Don't fail the regeneration if Zoho sync fails
      }
    }

    return new Response(JSON.stringify({
      success: true,
      enrollment_id: updatedEnrollment.id,
      enrollment_url: enrollmentUrl,
      expires_at: expiresAt.toISOString(),
      token_last4: tokenLast4,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in regenerate-enrollment:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Internal server error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
