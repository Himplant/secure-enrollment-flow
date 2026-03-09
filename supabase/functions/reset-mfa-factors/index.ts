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

    if (adminUser.mfa_method) {
      return new Response(JSON.stringify({ error: "MFA already configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use Admin API to force-delete all MFA factors
    const { data: factors } = await supabaseAdmin.auth.admin.mfa.listFactors({
      userId: user.id,
    });

    let deleted = 0;
    if (factors?.factors) {
      for (const factor of factors.factors) {
        await supabaseAdmin.auth.admin.mfa.deleteFactor({
          userId: user.id,
          factorId: factor.id,
        });
        deleted++;
      }
    }

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
