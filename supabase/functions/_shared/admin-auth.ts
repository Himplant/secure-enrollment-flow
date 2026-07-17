// Shared admin authentication helper.
// Validates the bearer JWT, verifies the caller is an accepted admin,
// and enforces AAL2 (MFA-completed) sessions so a stolen password alone
// cannot call admin edge functions.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

export interface AdminAuthOk {
  ok: true;
  userId: string;
  email: string | null;
  supabaseAdmin: ReturnType<typeof createClient>;
}
export interface AdminAuthErr {
  ok: false;
  response: Response;
}
export type AdminAuthResult = AdminAuthOk | AdminAuthErr;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export async function requireAdmin(
  req: Request,
  opts: { requireAal2?: boolean } = {},
): Promise<AdminAuthResult> {
  const requireAal2 = opts.requireAal2 ?? true;
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }
  const user = userData.user;

  const supabaseAdmin = createClient(url, service);
  const { data: adminRow } = await supabaseAdmin
    .from("admin_users")
    .select("id")
    .eq("user_id", user.id)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (!adminRow) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  if (requireAal2) {
    const { data: aal } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal || aal.currentLevel !== "aal2") {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: "MFA required" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }),
      };
    }
  }

  return { ok: true, userId: user.id, email: user.email ?? null, supabaseAdmin };
}

// Timing-safe(ish) check for shared cron secret. Used by cron-triggered
// endpoints that don't have a user context.
export function hasValidCronSecret(req: Request): boolean {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return false;
  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("X-Cron-Secret") ??
    "";
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}
