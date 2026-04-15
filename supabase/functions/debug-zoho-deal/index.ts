import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getZohoAccessToken(): Promise<string> {
  const clientId = Deno.env.get("ZOHO_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
  const refreshToken = Deno.env.get("ZOHO_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Missing Zoho credentials");
  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const sb = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessToken = await getZohoAccessToken();
    
    // Fetch just 2 deals with ALL fields to see what's available
    const url = `https://www.zohoapis.com/crm/v6/Deals?criteria=(Enrollment_Status:equals:Paid)&page=1&per_page=2`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    if (!res.ok) throw new Error(`Zoho error: ${await res.text()}`);
    const data = await res.json();
    
    // Return field names and values for first deal
    const deals = data.data || [];
    const fieldSample = deals.map((d: any) => {
      const fields: Record<string, any> = {};
      for (const [key, val] of Object.entries(d)) {
        // Only include surgeon-related and key fields
        const lk = key.toLowerCase();
        if (lk.includes("surgeon") || lk.includes("doctor") || lk.includes("dr") || 
            key === "Deal_Name" || key === "Stage" || key === "Owner" || key === "Contact_Name" || key === "Email") {
          fields[key] = val;
        }
      }
      return fields;
    });
    
    // Also return ALL field names from first deal
    const allFieldNames = deals.length > 0 ? Object.keys(deals[0]) : [];

    return new Response(JSON.stringify({ fieldSample, allFieldNames }, null, 2), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
