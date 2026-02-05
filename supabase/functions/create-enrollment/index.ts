import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shared-secret, x-hmac-signature, x-hmac-timestamp",
};

interface EnrollmentRequest {
  zoho_record_id: string;
  zoho_module: string;
  patient_name?: string;
  patient_email?: string;
  patient_phone?: string;
  amount_cents: number;
  currency?: string;
   terms_url?: string;
   privacy_url?: string;
   terms_version?: string;
   terms_sha256?: string;
   policy_id?: string;  // Optional: use specific policy by ID
  expires_in_hours?: number;
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

async function hmacSha256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign("HMAC", key, messageData);
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function validateHmac(
  body: string,
  signature: string,
  timestamp: string,
  secret: string
): Promise<boolean> {
  const message = `${timestamp}.${body}`;
  const expectedSig = await hmacSha256(message, secret);
  
  // Constant-time comparison
  if (signature.length !== expectedSig.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return result === 0;
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
    const sharedSecret = Deno.env.get("ENROLLMENT_SHARED_SECRET");
    if (!sharedSecret) {
      throw new Error("ENROLLMENT_SHARED_SECRET not configured");
    }

    const bodyText = await req.text();
    
    // Validate authentication - either shared secret or HMAC
    const headerSecret = req.headers.get("x-shared-secret");
    const hmacSignature = req.headers.get("x-hmac-signature");
    const hmacTimestamp = req.headers.get("x-hmac-timestamp");

    let authenticated = false;

    if (headerSecret) {
      // Simple shared secret auth
      authenticated = headerSecret === sharedSecret;
    } else if (hmacSignature && hmacTimestamp) {
      // HMAC signature auth
      const timestampAge = Date.now() - parseInt(hmacTimestamp, 10);
      if (timestampAge > 300000) { // 5 minutes
        return new Response(JSON.stringify({ error: "Request timestamp expired" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      authenticated = await validateHmac(bodyText, hmacSignature, hmacTimestamp, sharedSecret);
    }

    if (!authenticated) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: EnrollmentRequest = JSON.parse(bodyText);

     // Validate required fields (terms data is now optional - will use default policy)
     if (!body.zoho_record_id || !body.zoho_module || !body.amount_cents) {
      return new Response(JSON.stringify({ 
        error: "Missing required fields",
         required: ["zoho_record_id", "zoho_module", "amount_cents"]
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

     // Get policy data - either use specified policy, or default policy
     let policy;
     if (body.policy_id) {
       const { data, error } = await supabase
         .from("policies")
         .select("*")
         .eq("id", body.policy_id)
         .eq("is_active", true)
         .single();
       
       if (error || !data) {
         return new Response(JSON.stringify({ error: "Specified policy not found or inactive" }), {
           status: 400,
           headers: { ...corsHeaders, "Content-Type": "application/json" },
         });
       }
       policy = data;
     } else if (!body.terms_url || !body.terms_sha256) {
       // If terms data not provided, use default policy
       const { data, error } = await supabase
         .from("policies")
         .select("*")
         .eq("is_default", true)
         .eq("is_active", true)
         .single();
       
       if (error || !data) {
         return new Response(JSON.stringify({ 
           error: "No default policy found. Please create a policy in the admin dashboard first, or pass terms_url, privacy_url, terms_version, and terms_sha256." 
         }), {
           status: 400,
           headers: { ...corsHeaders, "Content-Type": "application/json" },
         });
       }
       policy = data;
     }
 
    // Generate secure token
    const rawToken = generateSecureToken(32);
    const tokenHash = await sha256Hash(rawToken);
    const tokenLast4 = rawToken.slice(-4);

    // Calculate expiration (default 48 hours)
    const expiresInHours = body.expires_in_hours ?? 48;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    // Create enrollment record
    const { data: enrollment, error: insertError } = await supabase
      .from("enrollments")
      .insert({
        zoho_record_id: body.zoho_record_id,
        zoho_module: body.zoho_module,
        patient_name: body.patient_name,
        patient_email: body.patient_email,
        patient_phone: body.patient_phone,
        amount_cents: body.amount_cents,
        currency: body.currency ?? "usd",
         policy_id: policy?.id || null,
         terms_url: policy?.terms_url || body.terms_url,
         privacy_url: policy?.privacy_url || body.privacy_url,
         terms_version: policy?.version || body.terms_version,
         terms_sha256: policy?.terms_content_sha256 || body.terms_sha256,
        token_hash: tokenHash,
        token_last4: tokenLast4,
        expires_at: expiresAt.toISOString(),
        status: "created",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to create enrollment:", insertError);
      throw new Error(`Failed to create enrollment: ${insertError.message}`);
    }

    // Log the created event
    await supabase.from("enrollment_events").insert({
      enrollment_id: enrollment.id,
      event_type: "created",
      event_data: {
         source: "zoho_crm",
        zoho_record_id: body.zoho_record_id,
        zoho_module: body.zoho_module,
        amount_cents: body.amount_cents,
        expires_at: expiresAt.toISOString(),
         policy_id: policy?.id || null,
         policy_name: policy?.name || "custom",
      },
    });

    // Build enrollment URL
    const baseUrl = req.headers.get("origin") || Deno.env.get("PUBLIC_URL") || "https://secure-enrollment-flow.lovable.app";
     const enrollmentUrl = `${baseUrl}/enroll/${rawToken}`;

    console.log(`Created enrollment ${enrollment.id} for Zoho record ${body.zoho_record_id}`);

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
    console.error("Error in create-enrollment:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Internal server error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
