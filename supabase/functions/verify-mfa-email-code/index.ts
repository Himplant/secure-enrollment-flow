import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rate limit: max 5 verification attempts per 10 minutes per user
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

// Track failed attempts in memory (resets on function cold start, but still useful)
const failedAttempts = new Map<string, { count: number; firstAttempt: number }>();

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: Rate limiting on verification attempts
    const now = Date.now();
    const userAttempts = failedAttempts.get(user.id);
    if (userAttempts) {
      if (now - userAttempts.firstAttempt < RATE_LIMIT_WINDOW_MS) {
        if (userAttempts.count >= RATE_LIMIT_MAX) {
          return new Response(JSON.stringify({ error: "Too many failed attempts. Please wait before trying again." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        // Window expired, reset
        failedAttempts.delete(user.id);
      }
    }

    const { code } = await req.json();
    if (!code || typeof code !== "string" || code.length !== 6 || !/^\d{6}$/.test(code)) {
      return new Response(JSON.stringify({ error: "Invalid code format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Find valid code
    const { data: mfaCode, error: fetchError } = await supabaseAdmin
      .from("mfa_email_codes")
      .select("*")
      .eq("user_id", user.id)
      .eq("code", code.trim())
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError || !mfaCode) {
      // Track failed attempt
      const existing = failedAttempts.get(user.id);
      if (existing && now - existing.firstAttempt < RATE_LIMIT_WINDOW_MS) {
        existing.count++;
      } else {
        failedAttempts.set(user.id, { count: 1, firstAttempt: now });
      }

      return new Response(JSON.stringify({ error: "Invalid or expired code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark code as used
    await supabaseAdmin
      .from("mfa_email_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", mfaCode.id);

    // Clear failed attempts on success
    failedAttempts.delete(user.id);

    return new Response(JSON.stringify({ success: true, verified: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
