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
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Failed to refresh Zoho token: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

interface ZohoDeal {
  id: string;
  Deal_Name?: string;
  Stage?: string;
  Surgery_Date?: string;
  $750_Credit_Applies_Until?: string;
  $500_Credit_Applies_Until?: string;
  Enrollment_Status?: string;
  Enrollment_Date?: string;
  Owner?: { name?: string; email?: string };
  Surgeon_Name?: string;
  // The surgeon lookup field — try common names
  Surgeon?: { name?: string; id?: string };
  Contact_Name?: { name?: string };
}

function parseZohoDate(val: string | undefined | null): string | null {
  if (!val) return null;
  // Zoho dates come as "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS"
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

function calculateCredit(
  stage: string | undefined,
  surgeryDate: string | null,
  credit750Expires: string | null,
  credit500Expires: string | null
): { credit_amount: number; credit_status: string } {
  if (stage === "Surgery Completed" && surgeryDate) {
    if (credit750Expires && surgeryDate <= credit750Expires) {
      return { credit_amount: 750, credit_status: "earned" };
    }
    if (credit500Expires && surgeryDate <= credit500Expires) {
      return { credit_amount: 500, credit_status: "earned" };
    }
    return { credit_amount: 0, credit_status: "forfeited" };
  }

  // Not completed yet — check if windows are still open
  if (stage === "Surgery Canceled" || stage === "Canceled") {
    return { credit_amount: 0, credit_status: "forfeited" };
  }

  const today = new Date().toISOString().split("T")[0];
  if (credit500Expires && today > credit500Expires) {
    return { credit_amount: 0, credit_status: "forfeited" };
  }

  // Still pending
  if (credit750Expires && today <= credit750Expires) {
    return { credit_amount: 750, credit_status: "pending" };
  }
  if (credit500Expires && today <= credit500Expires) {
    return { credit_amount: 500, credit_status: "pending" };
  }

  return { credit_amount: 0, credit_status: "pending" };
}

async function fetchDealsFromZoho(accessToken: string): Promise<ZohoDeal[]> {
  const deals: ZohoDeal[] = [];
  let page = 1;
  let hasMore = true;
  const fields = "Deal_Name,Stage,Surgery_Date,$750_Credit_Applies_Until,$500_Credit_Applies_Until,Enrollment_Status,Enrollment_Date,Owner,Surgeon_Name";

  while (hasMore) {
    const url = `https://www.zohoapis.com/crm/v6/Deals?fields=${fields}&criteria=(Enrollment_Status:equals:Paid)&page=${page}&per_page=200`;
    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

    if (res.status === 204) break;
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Zoho API error (page ${page}):`, errText);
      throw new Error(`Zoho API error: ${errText}`);
    }

    const data = await res.json();
    if (data.data && Array.isArray(data.data)) {
      deals.push(...data.data);
    }
    hasMore = data.info?.more_records ?? false;
    page++;
  }

  return deals;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: adminUser } = await supabase
      .from("admin_users")
      .select("id, role, email")
      .eq("user_id", user.id)
      .not("accepted_at", "is", null)
      .maybeSingle();

    if (!adminUser) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch deals from Zoho
    const accessToken = await getZohoAccessToken();
    const deals = await fetchDealsFromZoho(accessToken);
    console.log(`Fetched ${deals.length} paid deals from Zoho`);

    // Fetch surgeons for matching
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: surgeons } = await supabaseAdmin.from("surgeons").select("id, name");
    const surgeonMap = new Map<string, string>();
    for (const s of surgeons || []) {
      surgeonMap.set(s.name.toLowerCase(), s.id);
    }

    let upserted = 0;
    let skipped = 0;

    for (const deal of deals) {
      const surgeonName = deal.Surgeon_Name || deal.Deal_Name?.split(" - ")?.[0] || "Unknown";
      const surgeryDate = parseZohoDate(deal.Surgery_Date);
      const credit750Expires = parseZohoDate(deal.$750_Credit_Applies_Until);
      const credit500Expires = parseZohoDate(deal.$500_Credit_Applies_Until);
      const enrollmentDate = parseZohoDate(deal.Enrollment_Date);

      const { credit_amount, credit_status } = calculateCredit(
        deal.Stage, surgeryDate, credit750Expires, credit500Expires
      );

      // Match surgeon
      const surgeonId = surgeonMap.get(surgeonName.toLowerCase().replace(/^dr\.?\s*/i, "").trim()) ||
                         surgeonMap.get(surgeonName.toLowerCase()) || null;

      const consultantEmail = deal.Owner?.email || null;
      const patientName = deal.Deal_Name || "Unknown";

      // Check if already issued — don't overwrite
      const { data: existing } = await supabaseAdmin
        .from("surgeon_credits")
        .select("id, credit_status")
        .eq("zoho_deal_id", deal.id)
        .maybeSingle();

      if (existing?.credit_status === "issued") {
        skipped++;
        continue;
      }

      const record = {
        zoho_deal_id: deal.id,
        surgeon_id: surgeonId,
        surgeon_name: surgeonName,
        patient_name: patientName,
        consultant_email: consultantEmail,
        enrollment_date: enrollmentDate,
        surgery_date: surgeryDate,
        stage: deal.Stage || null,
        credit_750_expires: credit750Expires,
        credit_500_expires: credit500Expires,
        credit_amount,
        credit_status,
        source: "zoho" as const,
      };

      if (existing) {
        await supabaseAdmin
          .from("surgeon_credits")
          .update(record)
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("surgeon_credits").insert(record);
      }
      upserted++;
    }

    console.log(`Sync complete: ${upserted} upserted, ${skipped} skipped (issued)`);

    return new Response(
      JSON.stringify({ success: true, total: deals.length, upserted, skipped }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error syncing credits:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
