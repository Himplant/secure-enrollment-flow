import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const refreshToken = Deno.env.get("ZOHO_REFRESH_TOKEN");
    const clientId = Deno.env.get("ZOHO_CLIENT_ID");
    const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");

    if (!refreshToken || !clientId || !clientSecret) {
      return new Response(JSON.stringify({ 
        success: false,
        error: "Missing Zoho credentials",
        details: {
          hasRefreshToken: !!refreshToken,
          hasClientId: !!clientId,
          hasClientSecret: !!clientSecret,
        }
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Attempt to get access token
    const tokenResponse = await fetch("https://accounts.zoho.com/oauth/v2/token", {
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

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || tokenData.error) {
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to refresh token",
        details: tokenData,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Test API access - try org info which requires minimal scope
    const orgResponse = await fetch("https://www.zohoapis.com/crm/v6/org", {
      headers: {
        Authorization: `Zoho-oauthtoken ${tokenData.access_token}`,
      },
    });

    const orgData = await orgResponse.json();

    // If org fails, try modules endpoint
    if (!orgResponse.ok) {
      const modulesResponse = await fetch("https://www.zohoapis.com/crm/v6/settings/modules", {
        headers: {
          Authorization: `Zoho-oauthtoken ${tokenData.access_token}`,
        },
      });
      
      const modulesData = await modulesResponse.json();
      
      if (!modulesResponse.ok) {
        return new Response(JSON.stringify({
          success: false,
          error: "Token works but API calls failed - may need additional scopes",
          token_valid: true,
          api_error: modulesData,
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
        note: "User info scope not available, but CRM access works",
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

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
