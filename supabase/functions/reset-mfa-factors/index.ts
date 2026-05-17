import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
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

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Only allow reset if admin user has mfa_method = null (fresh/re-invite)
    const { data: adminUser } = await supabaseAdmin
      .from("admin_users")
      .select("mfa_method")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!adminUser) {
      return new Response(JSON.stringify({ error: "Not an admin user" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // List existing factors
    const { data: factors } = await supabaseAdmin.auth.admin.mfa.listFactors({
      userId: user.id,
    });

    const allFactors = factors?.factors ?? [];
    const hasVerified = allFactors.some((f: any) => f.status === "verified");

    // If a verified factor already exists AND mfa_method is set, refuse —
    // user must complete the MFA challenge instead of resetting.
    if (hasVerified && adminUser.mfa_method) {
      return new Response(JSON.stringify({ error: "MFA already configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Otherwise: delete ALL factors (verified or unverified) so the user can
    // re-enroll cleanly. This handles the stuck state where mfa_method='totp'
    // but only unverified factors exist (preventing both challenge and re-enroll).
    let deleted = 0;
    for (const factor of allFactors) {
      await supabaseAdmin.auth.admin.mfa.deleteFactor({
        userId: user.id,
        factorId: factor.id,
      });
      deleted++;
    }

    // Clear stale mfa_method so the setup flow can run cleanly
    await supabaseAdmin
      .from("admin_users")
      .update({ mfa_method: null })
      .eq("user_id", user.id);

    return new Response(JSON.stringify({ success: true, deleted }), {
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
