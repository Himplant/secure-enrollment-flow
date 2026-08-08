import { jwtHasAal2 } from "../_shared/admin-auth.ts";
import { isCronRequest } from "../_shared/cron-auth.ts";
// Pulls Zoho Deal Enrollment_Status changes back into our enrollments table.
// Specifically handles when a deal is marked Canceled / Expired in the CRM
// after the link was sent — we update the local status so the dashboard reflects reality.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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
  if (!res.ok) throw new Error(`Zoho token refresh failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

// Map Zoho Enrollment_Status to our local enrollment_status enum.
// Returns null if there's no actionable mapping.
function mapZohoStatus(zohoStatus: string | undefined | null): string | null {
  if (!zohoStatus) return null;
  const s = zohoStatus.trim().toLowerCase();
  if (s === "canceled" || s === "cancelled") return "canceled";
  if (s === "expired") return "expired";
  if (s === "refunded") return "refunded";
  // We do NOT map "Paid" here — that flow is owned by Stripe webhook to avoid
  // creating fake paid records (see prior backfill incident).
  return null;
}

// Statuses that are terminal on our side and should not be overwritten by a CRM change.
// `paid` and `refunded` reflect actual money movement; only Stripe webhooks should change those.
const PROTECTED_LOCAL_STATUSES = new Set(["paid", "refunded"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Allow cron/service call via shared secret; otherwise require admin + AAL2.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const providedCron = req.headers.get("x-cron-secret") ?? "";
    const isCron = !!cronSecret && providedCron === cronSecret;

    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const adminCheck = createClient(supabaseUrl, supabaseServiceKey);
      const { data: adminUser } = await adminCheck
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
    }


    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Pull all enrollments that are still in a non-terminal state and have a Zoho Deal id.
    // We only need to check ones that could be flipped by the CRM (created/sent/opened/processing/failed/expired/canceled).
    const { data: enrollments, error: enrollErr } = await supabaseAdmin
      .from("enrollments")
      .select("id, status, zoho_record_id, zoho_module, patient_email")
      .eq("zoho_module", "Deals")
      .not("zoho_record_id", "is", null)
      .not("status", "in", "(paid,refunded)");

    if (enrollErr) throw enrollErr;
    if (!enrollments || enrollments.length === 0) {
      return new Response(JSON.stringify({ success: true, checked: 0, updated: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getZohoAccessToken();
    let updated = 0;
    const changes: Array<{ id: string; email: string | null; from: string; to: string }> = [];

    // Fetch deals in parallel batches of 10 to avoid Zoho rate limits
    const CONCURRENCY = 10;
    for (let i = 0; i < enrollments.length; i += CONCURRENCY) {
      const batch = enrollments.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (e) => {
        try {
          const res = await fetch(
            `https://www.zohoapis.com/crm/v6/Deals/${e.zoho_record_id}`,
            { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
          );
          if (!res.ok) {
            if (res.status !== 204) console.warn(`Zoho fetch ${e.zoho_record_id} -> ${res.status}`);
            return null;
          }
          const data = await res.json();
          const deal = data?.data?.[0];
          if (!deal) return null;
          const target = mapZohoStatus(deal.Enrollment_Status);
          if (!target) return null;
          if (PROTECTED_LOCAL_STATUSES.has(e.status)) return null;
          if (e.status === target) return null;
          return { enrollment: e, target, zohoStatus: deal.Enrollment_Status };
        } catch (err) {
          console.error(`Error checking ${e.zoho_record_id}:`, err);
          return null;
        }
      }));

      for (const r of results) {
        if (!r) continue;
        const tsField = r.target === "canceled" ? "expired_at" : (r.target === "expired" ? "expired_at" : "refunded_at");
        const update: Record<string, any> = {
          status: r.target,
          updated_at: new Date().toISOString(),
        };
        // Stamp a timestamp column to mirror what other flows do
        if (r.target === "canceled" || r.target === "expired") {
          update.expired_at = new Date().toISOString();
        } else if (r.target === "refunded") {
          update.refunded_at = new Date().toISOString();
        }

        const { error: upErr } = await supabaseAdmin
          .from("enrollments")
          .update(update)
          .eq("id", r.enrollment.id);
        if (upErr) {
          console.error(`Failed to update ${r.enrollment.id}:`, upErr.message);
          continue;
        }

        // Audit event
        await supabaseAdmin.from("enrollment_events").insert({
          enrollment_id: r.enrollment.id,
          event_type: `status_synced_from_zoho:${r.target}`,
          event_data: { previous_status: r.enrollment.status, zoho_enrollment_status: r.zohoStatus },
        });

        updated++;
        changes.push({
          id: r.enrollment.id,
          email: r.enrollment.patient_email,
          from: r.enrollment.status,
          to: r.target,
        });
      }
    }

    console.log(`sync-enrollment-statuses: checked ${enrollments.length}, updated ${updated}`);
    return new Response(
      JSON.stringify({ success: true, checked: enrollments.length, updated, changes }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("sync-enrollment-statuses error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
