import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    throw new Error(`Failed to refresh Zoho token: ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require admin auth
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

    // Use service role for DB operations
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get enrollments missing owner_name that have a real zoho_record_id
    const { data: enrollments, error: fetchError } = await supabaseAdmin
      .from("enrollments")
      .select("id, zoho_record_id, zoho_module")
      .is("owner_name", null)
      .not("zoho_module", "eq", "manual")
      .limit(500);

    if (fetchError) throw fetchError;

    if (!enrollments || enrollments.length === 0) {
      return new Response(JSON.stringify({ message: "No enrollments to backfill", updated: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${enrollments.length} enrollments to backfill`);

    const accessToken = await getZohoAccessToken();

    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const enrollment of enrollments) {
      try {
        const zohoResp = await fetch(
          `https://www.zohoapis.com/crm/v6/${enrollment.zoho_module}/${enrollment.zoho_record_id}?fields=Owner`,
          {
            headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
          }
        );

        if (!zohoResp.ok) {
          const errText = await zohoResp.text();
          console.warn(`Zoho fetch failed for ${enrollment.zoho_record_id}: ${zohoResp.status} ${errText}`);
          errors.push(`${enrollment.zoho_record_id}: ${zohoResp.status}`);
          failed++;
          continue;
        }

        const zohoData = await zohoResp.json();
        const record = zohoData?.data?.[0];
        const ownerName = record?.Owner?.name || null;

        if (ownerName) {
          await supabaseAdmin
            .from("enrollments")
            .update({ owner_name: ownerName })
            .eq("id", enrollment.id);
          updated++;
          console.log(`Updated ${enrollment.id} -> owner: ${ownerName}`);
        } else {
          console.log(`No owner found for ${enrollment.zoho_record_id}`);
        }

        // Small delay to avoid Zoho rate limits
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`Error processing ${enrollment.id}:`, err);
        failed++;
      }
    }

    return new Response(JSON.stringify({
      message: "Backfill complete",
      total: enrollments.length,
      updated,
      failed,
      errors: errors.slice(0, 10),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Backfill error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Internal error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
