import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    const errorText = await response.text();
    throw new Error(`Failed to refresh Zoho token: ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function updateZohoRecord(
  module: string,
  recordId: string,
  data: Record<string, unknown>
): Promise<void> {
  const accessToken = await getZohoAccessToken();

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
    console.error(`Failed to update Zoho record: ${errorText}`);
  } else {
    console.log(`Updated Zoho ${module}/${recordId}`);
  }
}

async function addZohoNote(
  module: string,
  recordId: string,
  title: string,
  content: string
): Promise<void> {
  const accessToken = await getZohoAccessToken();

  const response = await fetch("https://www.zohoapis.com/crm/v6/Notes", {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: [
        {
          Parent_Id: recordId,
          se_module: module,
          Note_Title: title,
          Note_Content: content,
        },
      ],
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

  try {
    // Verify admin auth
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: isAdmin } = await serviceClient.rpc("is_admin", { _user_id: user.id });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: enforce MFA (AAL2)
    {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: aal } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!aal || aal.currentLevel !== "aal2") {
        return new Response(JSON.stringify({ error: "MFA required" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }



    const { enrollment_id } = await req.json();
    if (!enrollment_id) {
      return new Response(JSON.stringify({ error: "enrollment_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch enrollment
    const { data: enrollment, error: fetchError } = await serviceClient
      .from("enrollments")
      .select("id, zoho_module, zoho_record_id, patient_name, patient_email, amount_cents, status, stripe_payment_intent_id, stripe_session_id, paid_at")
      .eq("id", enrollment_id)
      .single();

    if (fetchError || !enrollment) {
      return new Response(JSON.stringify({ error: "Enrollment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (enrollment.status !== "paid") {
      return new Response(JSON.stringify({ error: "Only paid enrollments can be refunded" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const refundDate = now.split("T")[0]; // YYYY-MM-DD for Zoho

    // Update enrollment status
    const { error: updateError } = await serviceClient
      .from("enrollments")
      .update({ status: "refunded", refunded_at: now })
      .eq("id", enrollment_id);

    if (updateError) throw updateError;

    // Remove any surgeon_credits row(s) tied to this enrollment or patient
    // so the internal credit list stays consistent with the refund.
    let removedCredits = 0;
    try {
      const { data: creditsByEnroll } = await serviceClient
        .from("surgeon_credits")
        .select("id")
        .eq("enrollment_id", enrollment_id);
      const idsToDelete = new Set<string>((creditsByEnroll ?? []).map((c: any) => c.id));

      if (enrollment.patient_email) {
        const { data: creditsByEmail } = await serviceClient
          .from("surgeon_credits")
          .select("id")
          .ilike("patient_email", enrollment.patient_email);
        for (const c of creditsByEmail ?? []) idsToDelete.add(c.id);
      }

      if (idsToDelete.size > 0) {
        const { error: delErr } = await serviceClient
          .from("surgeon_credits")
          .delete()
          .in("id", Array.from(idsToDelete));
        if (delErr) console.error("Failed to delete surgeon_credits:", delErr.message);
        else removedCredits = idsToDelete.size;
      }
    } catch (creditErr) {
      console.error("Credit cleanup failed (non-fatal):", creditErr);
    }

    // Audit log
    await serviceClient.from("admin_audit_log").insert({
      admin_user_id: user.id,
      admin_email: user.email,
      action: "refund",
      resource_type: "enrollment",
      resource_id: enrollment_id,
      resource_summary: {
        patient_name: enrollment.patient_name,
        amount_cents: enrollment.amount_cents,
        previous_status: enrollment.status,
        removed_surgeon_credits: removedCredits,
      },
    });

    // Update Zoho — mirror refund into CRM fields and clear the credit window
    // so the CRM's credit views match our internal credit list.
    try {
      await updateZohoRecord(enrollment.zoho_module, enrollment.zoho_record_id, {
        Enrollment_Status: "Refunded",
        Refund_Date: refundDate,
        Payment_Status: "Refunded",
        Credit_Applies_From: null,
        Credit_Applies_Until: null,
      });

      const amountFormatted = (enrollment.amount_cents / 100).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });

      const noteLines = [
        `Enrollment for ${enrollment.patient_name || "Unknown"} (${amountFormatted}) marked as Refunded on ${refundDate}.`,
        `Processed by: ${user.email}`,
        enrollment.stripe_payment_intent_id ? `Stripe PaymentIntent: ${enrollment.stripe_payment_intent_id}` : null,
        enrollment.stripe_session_id ? `Stripe Session: ${enrollment.stripe_session_id}` : null,
        enrollment.paid_at ? `Originally paid: ${enrollment.paid_at}` : null,
        `Internal surgeon credit rows removed: ${removedCredits}`,
        `CRM fields updated: Enrollment_Status=Refunded, Payment_Status=Refunded, Refund_Date=${refundDate}, Credit_Applies_From/Until cleared.`,
      ].filter(Boolean).join("\n");

      await addZohoNote(
        enrollment.zoho_module,
        enrollment.zoho_record_id,
        "Enrollment Refunded",
        noteLines
      );
    } catch (zohoError) {
      console.error("Zoho sync failed (non-fatal):", zohoError);
    }

    return new Response(JSON.stringify({ success: true, removed_surgeon_credits: removedCredits }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in mark-refunded:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
