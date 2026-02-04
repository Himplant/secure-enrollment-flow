import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ZohoSurgeon {
  id: string;
  Full_Name?: string;
  Name?: string;
  Email?: string;
  Phone?: string;
  Specialty?: string;
}

async function getZohoAccessToken(): Promise<string> {
  const clientId = Deno.env.get("ZOHO_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
  const refreshToken = Deno.env.get("ZOHO_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Zoho credentials");
  }

  const response = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh Zoho token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function fetchSurgeonsFromZoho(accessToken: string): Promise<ZohoSurgeon[]> {
  const surgeons: ZohoSurgeon[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `https://www.zohoapis.com/crm/v2/Surgeons?page=${page}&per_page=200`,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
      }
    );

    if (response.status === 204) {
      // No more records
      break;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch surgeons from Zoho: ${error}`);
    }

    const data = await response.json();
    if (data.data && Array.isArray(data.data)) {
      surgeons.push(...data.data);
    }

    hasMore = data.info?.more_records ?? false;
    page++;
  }

  return surgeons;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify admin access
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
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

    // Verify admin role
    const { data: adminUser, error: adminError } = await supabase
      .from("admin_users")
      .select("id, role")
      .eq("user_id", user.id)
      .not("accepted_at", "is", null)
      .maybeSingle();

    if (adminError || !adminUser) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch surgeons from Zoho
    const accessToken = await getZohoAccessToken();
    const zohoSurgeons = await fetchSurgeonsFromZoho(accessToken);

    console.log(`Fetched ${zohoSurgeons.length} surgeons from Zoho`);

    // Use service role for upsert
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Upsert surgeons
    let created = 0;
    let updated = 0;

    for (const surgeon of zohoSurgeons) {
      const surgeonData = {
        zoho_id: surgeon.id,
        name: surgeon.Full_Name || surgeon.Name || "Unknown",
        email: surgeon.Email || null,
        phone: surgeon.Phone || null,
        specialty: surgeon.Specialty || null,
        is_active: true,
      };

      const { data: existing } = await supabaseAdmin
        .from("surgeons")
        .select("id")
        .eq("zoho_id", surgeon.id)
        .maybeSingle();

      if (existing) {
        await supabaseAdmin
          .from("surgeons")
          .update(surgeonData)
          .eq("zoho_id", surgeon.id);
        updated++;
      } else {
        await supabaseAdmin.from("surgeons").insert(surgeonData);
        created++;
      }
    }

    console.log(`Sync complete: ${created} created, ${updated} updated`);

    return new Response(
      JSON.stringify({
        success: true,
        total: zohoSurgeons.length,
        created,
        updated,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error syncing surgeons:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
