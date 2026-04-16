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
  Active_Surgery_Date?: string;
  Credit_Applies_Until?: string;   // display: "$750 Credit Applies Until"
  Credit_Applies_From?: string;    // display: "$500 Credit Applies Until"
  Enrollment_Status?: string;
  Enrollment_Date?: string;
  Owner?: { name?: string; email?: string };
  Surgeon_Name_Lookup?: string;
  Surgeon?: { name?: string; id?: string };
  Contact_Name?: { name?: string; id?: string };
  Email?: string;
}

function parseZohoDate(val: string | undefined | null): string | null {
  if (!val) return null;
  // Use regex to extract YYYY-MM-DD directly to avoid timezone shifts
  const match = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  // Fallback for other formats
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

async function fetchDealsFromZoho(accessToken: string): Promise<ZohoDeal[]> {
  const deals: ZohoDeal[] = [];
  let page = 1;
  let hasMore = true;
  const fields = "Deal_Name,Stage,Active_Surgery_Date,Credit_Applies_Until,Credit_Applies_From,Enrollment_Status,Enrollment_Date,Owner,Surgeon_Name_Lookup,Surgeon,Email,Contact_Name";

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

    // Load surgeons by id, name, AND zoho_id (zoho_id is the most reliable match)
    const { data: surgeons } = await supabaseAdmin.from("surgeons").select("id, name, zoho_id");
    const surgeonById = new Map<string, string>();
    const surgeonByZohoId = new Map<string, { id: string; name: string }>();
    const surgeonNameMap = new Map<string, { id: string; name: string }>();
    for (const s of surgeons || []) {
      surgeonById.set(s.id, s.name);
      if (s.zoho_id) surgeonByZohoId.set(s.zoho_id, { id: s.id, name: s.name });
      const lower = s.name.toLowerCase();
      surgeonNameMap.set(lower, { id: s.id, name: s.name });
      const noDr = lower.replace(/^dr\.?\s*/i, "").trim();
      if (noDr !== lower) surgeonNameMap.set(noDr, { id: s.id, name: s.name });
    }

    // Load ALL patients (id, email, surgeon_id) — used as last-resort fallback AND for patient updates
    const { data: patients } = await supabaseAdmin.from("patients").select("id, email, surgeon_id").not("email", "is", null);
    const patientSurgeonMap = new Map<string, string>();
    const patientIdByEmail = new Map<string, string>();
    for (const p of patients || []) {
      if (p.email) {
        const key = p.email.toLowerCase().trim();
        patientIdByEmail.set(key, p.id);
        if (p.surgeon_id) patientSurgeonMap.set(key, p.surgeon_id);
      }
    }

    // Track patient surgeon updates needed (email -> new surgeon_id)
    const patientSurgeonUpdates: { patient_id: string; surgeon_id: string }[] = [];

    // Load existing credits — only fields needed for diffing
    const { data: allCredits } = await supabaseAdmin
      .from("surgeon_credits")
      .select("id, zoho_deal_id, patient_email, credit_status, credit_amount, stage, surgery_date, source, enrollment_id, credit_750_expires, credit_500_expires");

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
      const surgeryDate = parseZohoDate(deal.Active_Surgery_Date);
      const credit750Expires = parseZohoDate(deal.Credit_Applies_Until);
      const credit500Expires = parseZohoDate(deal.Credit_Applies_From);
      const enrollmentDate = parseZohoDate(deal.Enrollment_Date);
      const patientEmail = deal.Email || null;
      const consultantEmail = deal.Owner?.email || null;
      const patientName = deal.Contact_Name?.name || deal.Deal_Name || "Unknown";

      // Resolve surgeon — Zoho is the source of truth:
      // 1) Zoho Surgeon.id → surgeons.zoho_id (most reliable, exact ID match)
      // 2) Zoho Surgeon_Name_Lookup or Surgeon.name → surgeons.name (fuzzy)
      // 3) patients.surgeon_id (last resort only when Zoho has no surgeon)
      let surgeonId: string | null = null;
      let surgeonName = "Unknown";

      const zohoSurgeonId = deal.Surgeon?.id || null;
      if (zohoSurgeonId) {
        const match = surgeonByZohoId.get(zohoSurgeonId);
        if (match) { surgeonId = match.id; surgeonName = match.name; }
      }

      if (!surgeonId) {
        const rawSurgeonName = deal.Surgeon_Name_Lookup || deal.Surgeon?.name || null;
        if (rawSurgeonName) {
          const key = rawSurgeonName.toLowerCase().trim();
          const match = surgeonNameMap.get(key) || surgeonNameMap.get(key.replace(/^dr\.?\s*/i, "").trim());
          if (match) { surgeonId = match.id; surgeonName = match.name; }
          else { surgeonName = rawSurgeonName; }
        }
      }

      if (!surgeonId && patientEmail) {
        const sid = patientSurgeonMap.get(patientEmail.toLowerCase().trim());
        if (sid) {
          surgeonId = sid;
          surgeonName = surgeonById.get(sid) || "Unknown";
        }
      }

      // If resolved surgeon differs from patient's current surgeon_id, queue a patient update
      if (surgeonId && patientEmail) {
        const emailKey = patientEmail.toLowerCase().trim();
        const currentPatientSurgeon = patientSurgeonMap.get(emailKey);
        const patientId = patientIdByEmail.get(emailKey);
        if (patientId && currentPatientSurgeon !== surgeonId) {
          patientSurgeonUpdates.push({ patient_id: patientId, surgeon_id: surgeonId });
          patientSurgeonMap.set(emailKey, surgeonId); // avoid duplicate queueing
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

      // HYBRID RULE: For platform records (has enrollment_id), preserve credit dates
      // For CRM-native/import records, use CRM dates (never overwrite non-null with null)
      let finalCredit750 = credit750Expires;
      let finalCredit500 = credit500Expires;
      let finalSurgeryDate = surgeryDate;

      if (existing) {
        if (existing.enrollment_id) {
          // Platform record: only update stage & surgery_date from CRM, preserve credit dates
          finalCredit750 = existing.credit_750_expires || credit750Expires;
          finalCredit500 = existing.credit_500_expires || credit500Expires;
        } else {
          // CRM-native/import: use CRM dates, but never overwrite non-null with null
          finalCredit750 = credit750Expires || existing.credit_750_expires;
          finalCredit500 = credit500Expires || existing.credit_500_expires;
        }
        finalSurgeryDate = surgeryDate || existing.surgery_date;
      }

      const { credit_amount, credit_status } = calculateCredit(
        deal.Stage, finalSurgeryDate, finalCredit750, finalCredit500
      );

      // Skip if nothing meaningful changed
      if (existing && !isEmailMatch &&
          existing.credit_status === credit_status &&
          existing.credit_amount === credit_amount &&
          existing.stage === (deal.Stage || null) &&
          existing.surgery_date === finalSurgeryDate) {
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
        surgery_date: finalSurgeryDate,
        stage: deal.Stage || null,
        credit_750_expires: finalCredit750,
        credit_500_expires: finalCredit500,
        credit_amount,
        credit_status,
        source: "zoho",
      };

      if (isEmailMatch && existing) {
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

    // Update patients.surgeon_id where Zoho resolved a different surgeon than what's stored
    const dedupedPatientUpdates = Array.from(
      new Map(patientSurgeonUpdates.map(u => [u.patient_id, u])).values()
    );
    let patientsUpdated = 0;
    for (let i = 0; i < dedupedPatientUpdates.length; i += 20) {
      const chunk = dedupedPatientUpdates.slice(i, i + 20);
      const results = await Promise.all(
        chunk.map(({ patient_id, surgeon_id }) =>
          supabaseAdmin.from("patients").update({ surgeon_id }).eq("id", patient_id)
        )
      );
      for (const r of results) {
        if (r.error) console.error(`Patient surgeon update error:`, r.error.message);
        else patientsUpdated++;
      }
    }

    console.log(`Sync complete: ${upserted} upserted, ${skipped} skipped (issued), ${unchanged} unchanged, ${toUpdateById.length} email-matched, ${patientsUpdated} patient surgeon assignments updated`);

    return new Response(
      JSON.stringify({ success: true, total: deals.length, upserted, skipped, unchanged, patientsUpdated }),
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
