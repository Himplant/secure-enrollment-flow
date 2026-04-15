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
  Surgeon?: { name?: string; id?: string };
  Contact_Name?: { name?: string; id?: string };
  Email?: string;
}

function parseZohoDate(val: string | undefined | null): string | null {
  if (!val) return null;
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

  if (stage === "Surgery Canceled" || stage === "Canceled" || stage === "Close Lost") {
    return { credit_amount: 0, credit_status: "forfeited" };
  }

  const today = new Date().toISOString().split("T")[0];
  if (credit500Expires && today > credit500Expires) {
    return { credit_amount: 0, credit_status: "forfeited" };
  }
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
  const fields = "Deal_Name,Stage,Surgery_Date,$750_Credit_Applies_Until,$500_Credit_Applies_Until,Enrollment_Status,Enrollment_Date,Owner,Surgeon_Name,Surgeon,Email,Contact_Name";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Allow cron calls (anon key with no user) OR authenticated admin calls
    const authHeader = req.headers.get("Authorization");
    let isCronCall = false;

    if (authHeader) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (user) {
        // Authenticated user — verify admin access
        const supabaseAdminCheck = createClient(supabaseUrl, supabaseServiceKey);
        const { data: adminUser } = await supabaseAdminCheck
          .from("admin_users")
          .select("id")
          .eq("user_id", user.id)
          .not("accepted_at", "is", null)
          .maybeSingle();

        if (!adminUser) {
          return new Response(JSON.stringify({ error: "Admin access required" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        // No user resolved — treat as cron/service call
        isCronCall = true;
      }
    } else {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    }

    // Fetch deals from Zoho
    const accessToken = await getZohoAccessToken();
    const deals = await fetchDealsFromZoho(accessToken);
    console.log(`Fetched ${deals.length} paid deals from Zoho`);

    // --- BATCH: Load all existing credits and surgeons upfront ---
    const { data: surgeons } = await supabaseAdmin.from("surgeons").select("id, name");
    const surgeonMap = new Map<string, { id: string; name: string }>();
    for (const s of surgeons || []) {
      const lower = s.name.toLowerCase();
      surgeonMap.set(lower, { id: s.id, name: s.name });
      const noDr = lower.replace(/^dr\.?\s*/i, "").trim();
      if (noDr !== lower) surgeonMap.set(noDr, { id: s.id, name: s.name });
    }

    // Fetch ALL existing credits in one query (not one per deal)
    const { data: allCredits } = await supabaseAdmin
      .from("surgeon_credits")
      .select("id, zoho_deal_id, patient_email, credit_status, source");

    // Build lookup maps
    const creditsByZohoId = new Map<string, { id: string; credit_status: string; source: string }>();
    const creditsByEmail = new Map<string, { id: string; credit_status: string; source: string }>();
    for (const c of allCredits || []) {
      if (c.zoho_deal_id) {
        creditsByZohoId.set(c.zoho_deal_id, { id: c.id, credit_status: c.credit_status, source: c.source });
      }
      if (c.patient_email) {
        const key = c.patient_email.toLowerCase().trim();
        // For email lookup, prefer import records (they need updating from Zoho)
        const existing = creditsByEmail.get(key);
        if (!existing || c.source === "import") {
          creditsByEmail.set(key, { id: c.id, credit_status: c.credit_status, source: c.source });
        }
      }
    }

    let upserted = 0;
    let skipped = 0;

    // Batch upserts: collect all operations then execute in chunks
    const toInsert: any[] = [];
    const toUpdate: { id: string; record: any }[] = [];

    for (const deal of deals) {
      const rawSurgeonName = deal.Surgeon_Name || deal.Surgeon?.name || null;
      const surgeryDate = parseZohoDate(deal.Surgery_Date);
      const credit750Expires = parseZohoDate(deal.$750_Credit_Applies_Until);
      const credit500Expires = parseZohoDate(deal.$500_Credit_Applies_Until);
      const enrollmentDate = parseZohoDate(deal.Enrollment_Date);
      const patientEmail = deal.Email || null;
      const consultantEmail = deal.Owner?.email || null;
      const patientName = deal.Contact_Name?.name || deal.Deal_Name || "Unknown";

      const { credit_amount, credit_status } = calculateCredit(
        deal.Stage, surgeryDate, credit750Expires, credit500Expires
      );

      let surgeonId: string | null = null;
      let surgeonName = rawSurgeonName || "Unknown";
      if (rawSurgeonName) {
        const key = rawSurgeonName.toLowerCase().trim();
        const match = surgeonMap.get(key) || surgeonMap.get(key.replace(/^dr\.?\s*/i, "").trim());
        if (match) {
          surgeonId = match.id;
          surgeonName = match.name;
        }
      }

      // Check if record exists by zoho_deal_id first
      let existing = creditsByZohoId.get(deal.id);

      // If not found by zoho_deal_id, check by email (matches imported records)
      if (!existing && patientEmail) {
        const emailKey = patientEmail.toLowerCase().trim();
        const byEmail = creditsByEmail.get(emailKey);
        if (byEmail && byEmail.source === "import") {
          existing = byEmail;
        }
      }

      // Skip records already marked as "issued" — admin has finalized them
      if (existing?.credit_status === "issued") {
        skipped++;
        continue;
      }

      const record: any = {
        zoho_deal_id: deal.id,
        surgeon_id: surgeonId,
        surgeon_name: surgeonName,
        patient_name: patientName,
        patient_email: patientEmail,
        consultant_email: consultantEmail,
        enrollment_date: enrollmentDate,
        surgery_date: surgeryDate,
        stage: deal.Stage || null,
        credit_750_expires: credit750Expires,
        credit_500_expires: credit500Expires,
        credit_amount,
        credit_status,
        source: "zoho",
      };

      if (existing) {
        toUpdate.push({ id: existing.id, record });
      } else {
        toInsert.push(record);
      }
    }

    // Execute batch inserts (chunks of 100)
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = toInsert.slice(i, i + 100);
      const { error } = await supabaseAdmin.from("surgeon_credits").insert(chunk);
      if (error) console.error(`Insert batch error at ${i}:`, error.message);
      else upserted += chunk.length;
    }

    // Execute batch updates (chunks of 50 — each is an individual update by id)
    for (const { id, record } of toUpdate) {
      const { error } = await supabaseAdmin
        .from("surgeon_credits")
        .update(record)
        .eq("id", id);
      if (error) console.error(`Update error for ${id}:`, error.message);
      else upserted++;
    }

    console.log(`Sync complete: ${upserted} upserted, ${skipped} skipped (issued), ${toInsert.length} new, ${toUpdate.length} updated`);

    return new Response(
      JSON.stringify({ success: true, total: deals.length, upserted, skipped, newRecords: toInsert.length, updated: toUpdate.length }),
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
