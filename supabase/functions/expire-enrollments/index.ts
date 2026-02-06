import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

async function updateZohoRecord(
  accessToken: string,
  module: string,
  recordId: string,
  data: Record<string, unknown>
): Promise<void> {
  const response = await fetch(
    `https://www.zohoapis.com/crm/v6/${module}/${recordId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: [data] }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to update Zoho ${module}/${recordId}: ${errorText}`);
  } else {
    console.log(`Updated Zoho ${module}/${recordId} -> Expired`);
  }
}

async function addZohoNote(
  accessToken: string,
  module: string,
  recordId: string,
  title: string,
  content: string
): Promise<void> {
  const response = await fetch("https://www.zohoapis.com/crm/v6/Notes", {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: [{
        Parent_Id: recordId,
        se_module: module,
        Note_Title: title,
        Note_Content: content,
      }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to add Zoho note: ${errorText}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const now = new Date().toISOString();

    // Find all enrollments that are past expiry and not yet in a terminal state
    const activeStatuses = ["created", "sent", "opened"];
    const { data: expiredEnrollments, error: fetchError } = await supabase
      .from("enrollments")
      .select("id, zoho_module, zoho_record_id, amount_cents, status")
      .in("status", activeStatuses)
      .lt("expires_at", now);

    if (fetchError) {
      console.error("Failed to fetch expired enrollments:", fetchError);
      return new Response(JSON.stringify({ error: "Database error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!expiredEnrollments || expiredEnrollments.length === 0) {
      console.log("No enrollments to expire");
      return new Response(JSON.stringify({ expired: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${expiredEnrollments.length} enrollments to expire`);

    // Get Zoho token once for all updates
    let zohoAccessToken: string | null = null;
    try {
      zohoAccessToken = await getZohoAccessToken();
    } catch (err) {
      console.error("Failed to get Zoho access token:", err);
      // Continue - still expire in DB even if Zoho sync fails
    }

    let expiredCount = 0;

    for (const enrollment of expiredEnrollments) {
      // Update status to expired
      const { error: updateError } = await supabase
        .from("enrollments")
        .update({ status: "expired", expired_at: now })
        .eq("id", enrollment.id)
        .in("status", activeStatuses); // Safety: only update if still active

      if (updateError) {
        console.error(`Failed to expire enrollment ${enrollment.id}:`, updateError);
        continue;
      }

      // Log event
      await supabase.from("enrollment_events").insert({
        enrollment_id: enrollment.id,
        event_type: "auto_expired",
        event_data: {
          previous_status: enrollment.status,
          expired_by: "cron",
          timestamp: now,
        },
      });

      // Sync to Zoho
      if (zohoAccessToken && enrollment.zoho_record_id) {
        await updateZohoRecord(zohoAccessToken, enrollment.zoho_module, enrollment.zoho_record_id, {
          Enrollment_Status: "Expired",
        });

        await addZohoNote(
          zohoAccessToken,
          enrollment.zoho_module,
          enrollment.zoho_record_id,
          "Enrollment Expired",
          `Enrollment link expired without payment. Amount: $${(enrollment.amount_cents / 100).toFixed(2)}`
        );
      }

      expiredCount++;
    }

    console.log(`Successfully expired ${expiredCount} enrollments`);

    return new Response(JSON.stringify({ expired: expiredCount }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in expire-enrollments:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Internal server error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
