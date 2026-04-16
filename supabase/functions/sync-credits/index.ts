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
    if (credit750Expires && surgeryDate <= credit750Expires) return { credit_amount: 750, credit_status: "earned" };
    if (credit500Expires && surgeryDate <= credit500Expires) return { credit_amount: 500, credit_status: "earned" };
    return { credit_amount: 0, credit_status: "forfeited" };
  }
  if (stage === "Surgery Canceled" || stage === "Canceled" || stage === "Close Lost") {
    return { credit_amount: 0, credit_status: "forfeited" };
  }
  const today = new Date().toISOString().split("T")[0];
  if (credit500Expires && today > credit500Expires) return { credit_amount: 0, credit_status: "forfeited" };
  if (credit750Expires && today <= credit750Expires) return { credit_amount: 750, credit_status: "pending" };
  if (credit500Expires && today <= credit500Expires) return { credit_amount: 500, credit_status: "pending" };
  return { credit_amount: 0, credit_status: "pending" };
}

async function fetchDealFieldNames(accessToken: string): Promise<void> {
  const url = "https://www.zohoapis.com/crm/v6/settings/fields?module=Deals";
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  if (!res.ok) {
    console.error("Failed to fetch field names:", await res.text());
    return;
  }
  const data = await res.json();
  const fields = (data.fields || []).map((f: any) => ({ api_name: f.api_name, display_label: f.display_label }));
  const interesting = fields.filter((f: any) => 
    /credit|750|500|surgery|surgeon/i.test(f.api_name) || /credit|750|500|surgery|surgeon/i.test(f.display_label)
  );
  console.log("DIAGNOSTIC: Interesting Zoho Deal fields:", JSON.stringify(interesting));
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const supabaseAdminCheck = createClient(supabaseUrl, supabaseServiceKey);
      const { data: adminUser } = await supabaseAdminCheck
        .from("admin_users").select("id").eq("user_id", user.id)
        .not("accepted_at", "is", null).maybeSingle();
      if (!adminUser) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // If no user resolved, treat as cron/service call (allowed)

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch deals from Zoho
    const accessToken = await getZohoAccessToken();
    const allDeals = await fetchDealsFromZoho(accessToken);
    console.log(`Fetched ${allDeals.length} paid deals from Zoho`);

    // Load all known patient emails to filter relevant deals only
    const { data: allPatients } = await supabaseAdmin.from("patients").select("email").not("email", "is", null);
    const knownEmails = new Set<string>();
    for (const p of allPatients || []) {
      if (p.email) knownEmails.add(p.email.toLowerCase().trim());
    }

    // Filter: only process deals for patients that exist in our system
    const deals = allDeals.filter(d => d.Email && knownEmails.has(d.Email.toLowerCase().trim()));
    console.log(`Filtered to ${deals.length} deals matching known patients (out of ${allDeals.length})`);

    // Load surgeons by id
    const { data: surgeons } = await supabaseAdmin.from("surgeons").select("id, name");
    const surgeonById = new Map<string, string>();
    const surgeonNameMap = new Map<string, { id: string; name: string }>();
    for (const s of surgeons || []) {
      surgeonById.set(s.id, s.name);
      const lower = s.name.toLowerCase();
      surgeonNameMap.set(lower, { id: s.id, name: s.name });
      const noDr = lower.replace(/^dr\.?\s*/i, "").trim();
      if (noDr !== lower) surgeonNameMap.set(noDr, { id: s.id, name: s.name });
    }

    // Load patients with surgeon_id to resolve surgeon by email
    const { data: patients } = await supabaseAdmin.from("patients").select("email, surgeon_id").not("email", "is", null).not("surgeon_id", "is", null);
    const patientSurgeonMap = new Map<string, string>();
    for (const p of patients || []) {
      if (p.email && p.surgeon_id) {
        patientSurgeonMap.set(p.email.toLowerCase().trim(), p.surgeon_id);
      }
    }

    // Load existing credits — only fields needed for diffing
    const { data: allCredits } = await supabaseAdmin
      .from("surgeon_credits")
      .select("id, zoho_deal_id, patient_email, credit_status, credit_amount, stage, surgery_date, source");

    const creditsByZohoId = new Map<string, typeof allCredits extends (infer T)[] | null ? T : never>();
    const creditsByEmail = new Map<string, typeof allCredits extends (infer T)[] | null ? T : never>();
    for (const c of allCredits || []) {
      if (c.zoho_deal_id) creditsByZohoId.set(c.zoho_deal_id, c);
      if (c.patient_email) {
        const key = c.patient_email.toLowerCase().trim();
        const existing = creditsByEmail.get(key);
        if (!existing || c.source === "import") creditsByEmail.set(key, c);
      }
    }

    let upserted = 0;
    let skipped = 0;
    let unchanged = 0;

    // Separate: records that can be batch-upserted (new or zoho_deal_id match)
    // vs. email-matched import records (need individual update by id)
    const toUpsert: any[] = [];
    const toUpdateById: { id: string; record: any }[] = [];

    for (const deal of deals) {
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

      // Resolve surgeon: 1) from patients table via email, 2) from Zoho fields, 3) fallback
      let surgeonId: string | null = null;
      let surgeonName = "Unknown";

      // Primary: look up patient's surgeon from the patients table
      if (patientEmail) {
        const sid = patientSurgeonMap.get(patientEmail.toLowerCase().trim());
        if (sid) {
          surgeonId = sid;
          surgeonName = surgeonById.get(sid) || "Unknown";
        }
      }

      // Fallback: try Zoho deal fields
      if (!surgeonId) {
        const rawSurgeonName = deal.Surgeon_Name || deal.Surgeon?.name || null;
        if (rawSurgeonName) {
          const key = rawSurgeonName.toLowerCase().trim();
          const match = surgeonNameMap.get(key) || surgeonNameMap.get(key.replace(/^dr\.?\s*/i, "").trim());
          if (match) { surgeonId = match.id; surgeonName = match.name; }
          else { surgeonName = rawSurgeonName; }
        }
      }

      // Find existing record
      let existing = creditsByZohoId.get(deal.id);
      let isEmailMatch = false;
      if (!existing && patientEmail) {
        const byEmail = creditsByEmail.get(patientEmail.toLowerCase().trim());
        if (byEmail && byEmail.source === "import") {
          existing = byEmail;
          isEmailMatch = true;
        }
      }

      // Skip issued records
      if (existing?.credit_status === "issued") { skipped++; continue; }

      // Skip if nothing meaningful changed
      if (existing && !isEmailMatch &&
          existing.credit_status === credit_status &&
          existing.credit_amount === credit_amount &&
          existing.stage === (deal.Stage || null) &&
          existing.surgery_date === surgeryDate) {
        unchanged++;
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

      if (isEmailMatch && existing) {
        // Must update by primary key since there's no zoho_deal_id to conflict on
        toUpdateById.push({ id: existing.id, record });
      } else {
        toUpsert.push(record);
      }
    }

    // Batch upsert using zoho_deal_id conflict (chunks of 200)
    for (let i = 0; i < toUpsert.length; i += 200) {
      const chunk = toUpsert.slice(i, i + 200);
      const { error } = await supabaseAdmin
        .from("surgeon_credits")
        .upsert(chunk, { onConflict: "zoho_deal_id", ignoreDuplicates: false });
      if (error) console.error(`Upsert batch error at ${i}:`, error.message);
      else upserted += chunk.length;
    }

    // Batch update email-matched records (these are few — typically <100)
    // Do them in parallel batches of 20
    for (let i = 0; i < toUpdateById.length; i += 20) {
      const chunk = toUpdateById.slice(i, i + 20);
      const results = await Promise.all(
        chunk.map(({ id, record }) =>
          supabaseAdmin.from("surgeon_credits").update(record).eq("id", id)
        )
      );
      for (const r of results) {
        if (r.error) console.error(`Update error:`, r.error.message);
        else upserted++;
      }
    }

    console.log(`Sync complete: ${upserted} upserted, ${skipped} skipped (issued), ${unchanged} unchanged, ${toUpdateById.length} email-matched`);

    return new Response(
      JSON.stringify({ success: true, total: deals.length, upserted, skipped, unchanged }),
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
