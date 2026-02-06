import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

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
  surgeon_id?: string;        // Optional local surgeon UUID
  zoho_surgeon_id?: string;   // Zoho surgeon record ID (from lookup field)
  surgeon_zoho_id?: string;   // Alternative key name (from Zoho Deluge)
  surgeon_name?: string;      // Fallback surgeon name
  amount?: number;            // Decimal from Zoho (e.g., 500.00)
  amount_cents?: number;  // Legacy support for cents
  currency?: string;
  terms_url?: string;
  privacy_url?: string;
  terms_version?: string;
  terms_sha256?: string;
  policy_id?: string;
  expires_in_hours?: number;
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

// Update Zoho CRM record with enrollment data
async function updateZohoRecordWithEnrollment(
  module: string,
  recordId: string,
  enrollmentUrl: string,
  expiresAt: Date,
  tokenLast4: string
): Promise<void> {
  try {
    const accessToken = await getZohoAccessToken();

    // Format dates for Zoho
    // Enrollment_Date: YYYY-MM-DD format (Zoho date field format)
    const now = new Date();
    const enrollmentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    
    // Enrollment_Expires_At: Zoho datetime format (yyyy-MM-ddTHH:mm:ss+HH:mm)
    // Zoho requires timezone offset, not "Z" suffix
    const pad = (n: number) => String(n).padStart(2, "0");
    const expiresAtFormatted = `${expiresAt.getFullYear()}-${pad(expiresAt.getMonth() + 1)}-${pad(expiresAt.getDate())}T${pad(expiresAt.getHours())}:${pad(expiresAt.getMinutes())}:${pad(expiresAt.getSeconds())}+00:00`;

    const updateData: Record<string, unknown> = {
      Enrollment_Status: "created",
      Enrollment_Link: enrollmentUrl,
      Enrollment_Date: enrollmentDate,
      Enrollment_Expires_At: expiresAtFormatted,
      Enrollment_Token_Last4: tokenLast4,
    };

    const response = await fetch(
      `https://www.zohoapis.com/crm/v6/${module}/${recordId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: [updateData] }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to update Zoho record: ${errorText}`);
      // Don't throw - enrollment was still created successfully
    } else {
      console.log(`Updated Zoho ${module}/${recordId} with enrollment data`);
    }
  } catch (error) {
    console.error("Error updating Zoho record:", error);
    // Don't throw - enrollment was still created successfully
  }
}

// Helper function to find or create a patient
// Priority: match by email first, then phone
async function findOrCreatePatient(
  supabase: any,
  email: string | undefined,
  phone: string | undefined,
  name: string | undefined,
  surgeonId: string | undefined
): Promise<string | null> {
  if (!email && !phone) {
    return null;
  }

  // Primary: match by email
  if (email) {
    const { data: existingByEmail } = await supabase
      .from("patients")
      .select("id")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    
    if (existingByEmail) {
      // Update phone/name/surgeon if provided and patient found by email
      const updates: Record<string, string | null> = {};
      if (phone) updates.phone = phone;
      if (name?.trim()) updates.name = name.trim();
      if (surgeonId) updates.surgeon_id = surgeonId;
      if (Object.keys(updates).length > 0) {
        await supabase.from("patients").update(updates).eq("id", existingByEmail.id);
      }
      return existingByEmail.id;
    }
  }

  // Secondary: match by phone only if no email match
  if (phone) {
    const { data: existingByPhone } = await supabase
      .from("patients")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    
    if (existingByPhone) {
      // Update email/name/surgeon if provided and patient found by phone
      const updates: Record<string, string | null> = {};
      if (email) updates.email = email.toLowerCase();
      if (name?.trim()) updates.name = name.trim();
      if (surgeonId) updates.surgeon_id = surgeonId;
      if (Object.keys(updates).length > 0) {
        await supabase.from("patients").update(updates).eq("id", existingByPhone.id);
      }
      return existingByPhone.id;
    }
  }

  // Create new patient
  const patientName = name?.trim() || "Unknown Patient";
  const { data: newPatient, error } = await supabase
    .from("patients")
    .insert({
      name: patientName,
      email: email?.toLowerCase() || null,
      phone: phone || null,
      surgeon_id: surgeonId || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create patient:", error);
    return null;
  }

  console.log(`Created new patient ${newPatient.id} for ${email || phone}`);
  return newPatient.id;
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

// Helper to get header value case-insensitively
function getHeaderCaseInsensitive(headers: Headers, name: string): string | null {
  // Try exact match first
  const exact = headers.get(name);
  if (exact) return exact;
  
  // Try lowercase
  const lower = headers.get(name.toLowerCase());
  if (lower) return lower;
  
  // Iterate all headers for case-insensitive match
  const lowerName = name.toLowerCase();
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  return null;
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
    
    // Validate authentication - either shared secret or HMAC (case-insensitive headers)
    const headerSecret = getHeaderCaseInsensitive(req.headers, "x-shared-secret");
    const hmacSignature = getHeaderCaseInsensitive(req.headers, "x-hmac-signature");
    const hmacTimestamp = getHeaderCaseInsensitive(req.headers, "x-hmac-timestamp");

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
    
    // Debug log the incoming request
    console.log("Incoming enrollment request:", JSON.stringify({
      zoho_record_id: body.zoho_record_id,
      patient_name: body.patient_name,
      patient_email: body.patient_email,
      patient_phone: body.patient_phone,
      amount: body.amount,
    }));
    let amountCents: number;
    if (body.amount !== undefined) {
      // Zoho sends amount as decimal (e.g., 500.00)
      amountCents = Math.round(body.amount * 100);
    } else if (body.amount_cents !== undefined) {
      // Legacy support for amount_cents
      amountCents = body.amount_cents;
    } else {
      return new Response(JSON.stringify({ 
        error: "Missing required field: amount or amount_cents",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate required fields
    if (!body.zoho_record_id || !body.zoho_module) {
      return new Response(JSON.stringify({ 
        error: "Missing required fields",
        required: ["zoho_record_id", "zoho_module", "amount or amount_cents"]
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get policy data - either use specified policy, or default policy
    // Always load default policy if terms are not provided in request
    let policy;
    
    if (body.policy_id) {
      // Fetch specified policy
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
    } else if (!body.terms_url || !body.terms_sha256 || !body.terms_version) {
      // If any terms data is missing, fetch and use default policy
      const { data, error } = await supabase
         .from("policies")
         .select("*")
         .eq("is_default", true)
         .eq("is_active", true)
         .single();
      
      if (error || !data) {
        return new Response(JSON.stringify({ 
          error: "No default policy found. Please create a policy in the admin dashboard first, or provide complete terms_url, privacy_url, terms_version, and terms_sha256." 
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

    // Build the app URL for dynamic terms if policy has terms_text but no terms_url
    const appUrl = (Deno.env.get("APP_URL") || "https://secure-enrollment-flow.lovable.app").replace(/\/+$/, "");
    
    // Determine terms_url: prefer explicit URL, fall back to dynamic page if policy has text
    let termsUrl = policy?.terms_url || body.terms_url;
    if (!termsUrl && policy?.id) {
      // Policy exists but has no external URL - terms are displayed dynamically on enrollment page
      termsUrl = `${appUrl}/terms/${policy.id}`;
    }
    
    // Determine privacy_url similarly
    let privacyUrl = policy?.privacy_url || body.privacy_url;
    if (!privacyUrl && policy?.id) {
      privacyUrl = `${appUrl}/privacy/${policy.id}`;
    }
    
    // Final validation - ensure we have required fields
    if (!termsUrl || !privacyUrl) {
      return new Response(JSON.stringify({ 
        error: "Cannot create enrollment: terms_url or privacy_url is missing. Please configure the policy with valid URLs or terms content." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve surgeon: prefer zoho_surgeon_id lookup, fall back to direct surgeon_id
    let resolvedSurgeonId = body.surgeon_id || null;
    let resolvedSurgeonName = body.surgeon_name;
    const zohoSurgeonId = body.zoho_surgeon_id || body.surgeon_zoho_id;
    
    if (zohoSurgeonId && !resolvedSurgeonId) {
      const { data: surgeon } = await supabase
        .from("surgeons")
        .select("id, name")
        .eq("zoho_id", body.zoho_surgeon_id)
        .eq("is_active", true)
        .maybeSingle();
      
      if (surgeon) {
        resolvedSurgeonId = surgeon.id;
        resolvedSurgeonName = surgeon.name;
        console.log(`Resolved Zoho surgeon ${zohoSurgeonId} -> ${surgeon.name} (${surgeon.id})`);
      } else {
        console.warn(`Zoho surgeon ${zohoSurgeonId} not found in local surgeons table`);
      }
    }

    // Find or create patient record
    const patientId = await findOrCreatePatient(
      supabase,
      body.patient_email,
      body.patient_phone,
      body.patient_name,
      resolvedSurgeonId
    );

    // Check for existing open enrollment for the same Zoho record
    // Only create new if existing is in a final state (paid, expired, canceled)
    const finalStatuses = ['paid', 'expired', 'canceled'];
    const { data: existingEnrollment } = await supabase
      .from("enrollments")
      .select("id, status")
      .eq("zoho_record_id", body.zoho_record_id)
      .not("status", "in", `(${finalStatuses.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let enrollment;

    if (existingEnrollment) {
      // Update existing open enrollment with new token, expiry, and amount
      console.log(`Updating existing enrollment ${existingEnrollment.id} (status: ${existingEnrollment.status}) for Zoho record ${body.zoho_record_id}`);
      
      const { data: updated, error: updateError } = await supabase
        .from("enrollments")
        .update({
          patient_id: patientId,
          patient_name: body.patient_name,
          patient_email: body.patient_email,
          patient_phone: body.patient_phone,
          amount_cents: amountCents,
          currency: body.currency ?? "usd",
          policy_id: policy?.id || null,
          terms_url: termsUrl,
          privacy_url: privacyUrl,
          terms_version: policy?.version || body.terms_version,
          terms_sha256: policy?.terms_content_sha256 || body.terms_sha256,
          token_hash: tokenHash,
          token_last4: tokenLast4,
          expires_at: expiresAt.toISOString(),
          status: "created",
          opened_at: null,
          terms_accepted_at: null,
          terms_accept_ip: null,
          terms_accept_user_agent: null,
          processing_at: null,
          paid_at: null,
          failed_at: null,
          expired_at: null,
          stripe_session_id: null,
          stripe_payment_intent_id: null,
          stripe_customer_id: null,
          payment_method_type: null,
        })
        .eq("id", existingEnrollment.id)
        .select()
        .single();

      if (updateError) {
        console.error("Failed to update enrollment:", updateError);
        throw new Error(`Failed to update enrollment: ${updateError.message}`);
      }
      enrollment = updated;

      // Log the regenerated event
      await supabase.from("enrollment_events").insert({
        enrollment_id: enrollment.id,
        event_type: "regenerated",
        event_data: {
          source: "zoho_crm",
          zoho_record_id: body.zoho_record_id,
          previous_status: existingEnrollment.status,
          amount_cents: amountCents,
          expires_at: expiresAt.toISOString(),
          policy_id: policy?.id || null,
        },
      });
    } else {
      // Create new enrollment record
      const { data: inserted, error: insertError } = await supabase
        .from("enrollments")
        .insert({
          zoho_record_id: body.zoho_record_id,
          zoho_module: body.zoho_module,
          patient_id: patientId,
          patient_name: body.patient_name,
          patient_email: body.patient_email,
          patient_phone: body.patient_phone,
          amount_cents: amountCents,
          currency: body.currency ?? "usd",
          policy_id: policy?.id || null,
          terms_url: termsUrl,
          privacy_url: privacyUrl,
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
      enrollment = inserted;

      // Log the created event
      await supabase.from("enrollment_events").insert({
        enrollment_id: enrollment.id,
        event_type: "created",
        event_data: {
          source: "zoho_crm",
          zoho_record_id: body.zoho_record_id,
          zoho_module: body.zoho_module,
          amount_cents: amountCents,
          amount_decimal: body.amount,
          expires_at: expiresAt.toISOString(),
          policy_id: policy?.id || null,
          policy_name: policy?.name || "custom",
        },
      });
    }

    // Build enrollment URL using APP_URL environment variable (appUrl already defined above)
    const enrollmentUrl = `${appUrl}/enroll/${rawToken}`;

    console.log(`Enrollment ${enrollment.id} for Zoho record ${body.zoho_record_id} | URL: ${enrollmentUrl} | APP_URL: ${appUrl}`);

    // Update Zoho CRM record with enrollment data - MUST await before returning
    // Edge functions shut down after response, so fire-and-forget won't work
    let zohoUpdated = false;
    try {
      await updateZohoRecordWithEnrollment(
        body.zoho_module,
        body.zoho_record_id,
        enrollmentUrl,
        expiresAt,
        tokenLast4
      );
      zohoUpdated = true;
    } catch (err) {
      console.error("Zoho update failed:", err);
    }

    return new Response(JSON.stringify({
      success: true,
      enrollment_id: enrollment.id,
      enrollment_url: enrollmentUrl,
      expires_at: expiresAt.toISOString(),
      token_last4: tokenLast4,
      zoho_fields_updated: zohoUpdated,
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
