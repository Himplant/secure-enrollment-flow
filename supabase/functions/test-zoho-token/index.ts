import { jwtHasAal2 } from "../_shared/admin-auth.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // SECURITY: this endpoint exposes org info and validates internal credentials.
    // Require admin + AAL2 (MFA) — no unauthenticated access.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(url, service);
    const { data: adminUser } = await admin
      .from("admin_users").select("id").eq("user_id", user.id)
      .not("accepted_at", "is", null).maybeSingle();
    if (!adminUser) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!jwtHasAal2(authHeader)) {
      return new Response(JSON.stringify({ error: "MFA required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const refreshToken = Deno.env.get("ZOHO_REFRESH_TOKEN");
    const clientId = Deno.env.get("ZOHO_CLIENT_ID");
    const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");

    if (!refreshToken || !clientId || !clientSecret) {
      return new Response(JSON.stringify({
        success: false,
        error: "Missing Zoho credentials",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenResponse = await fetch("https://accounts.zoho.com/oauth/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || tokenData.error) {
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to refresh token",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgResponse = await fetch("https://www.zohoapis.com/crm/v6/org", {
      headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
    });
    const orgData = await orgResponse.json();

    if (!orgResponse.ok) {
      const modulesResponse = await fetch("https://www.zohoapis.com/crm/v6/settings/modules", {
        headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
      });
      const modulesData = await modulesResponse.json();
      if (!modulesResponse.ok) {
        return new Response(JSON.stringify({
          success: false,
          error: "Token works but API calls failed",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        success: true,
        message: "Zoho token is valid and working",
        token_expires_in: tokenData.expires_in,
        modules_count: modulesData.modules?.length || 0,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Zoho token is valid and working",
      token_expires_in: tokenData.expires_in,
      org: orgData.org?.[0] ? {
        company_name: orgData.org[0].company_name,
        zgid: orgData.org[0].zgid,
      } : null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (_error) {
    return new Response(JSON.stringify({
      success: false,
      error: "Internal error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
