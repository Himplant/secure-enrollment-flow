import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: adminUser } = await supabaseAdmin
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

    const body = await req.json();
    const payments: { id: string; amount: number }[] = [];

    if (body.payments && Array.isArray(body.payments)) {
      payments.push(...body.payments);
    } else if (body.credit_ids && Array.isArray(body.credit_ids)) {
      for (const id of body.credit_ids) {
        payments.push({ id, amount: -1 });
      }
    } else {
      return new Response(JSON.stringify({ error: "Missing payments or credit_ids" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    for (const payment of payments) {
      const { data: credit } = await supabaseAdmin
        .from("surgeon_credits")
        .select("id, credit_amount, credit_status")
        .eq("id", payment.id)
        .maybeSingle();

      if (!credit || credit.credit_status === "pending" || credit.credit_status === "forfeited") {
        continue;
      }

      const issuedAmount = payment.amount === -1 ? credit.credit_amount : payment.amount;

      await supabaseAdmin
        .from("surgeon_credits")
        .update({
          credit_status: "issued",
          issued_amount: issuedAmount,
          issued_at: new Date().toISOString(),
          issued_by: adminUser.email,
        })
        .eq("id", payment.id);

      await supabaseAdmin.from("admin_audit_log").insert({
        admin_user_id: user.id,
        admin_email: adminUser.email,
        action: "credit_issued",
        resource_type: "surgeon_credit",
        resource_id: payment.id,
        resource_summary: { issued_amount: issuedAmount, credit_amount: credit.credit_amount },
      });

      updated++;
    }

    return new Response(
      JSON.stringify({ success: true, updated }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error marking credits:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
