// Shared authentication helper for EXTERNAL portal users
// (distributors, surgeons, clinic office staff).
//
// Deliberately does NOT import ../_shared/admin-auth.ts. Keeping the two
// guards fully separate means no international change can weaken the
// Himplant admin auth path or its mandatory AAL2 requirement.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export type PortalRole =
  | "distributor_admin"
  | "distributor_staff"
  | "distributor_analyst"
  | "surgeon_admin"
  | "surgeon_staff"
  | "surgeon_analyst";

export interface PortalMembership {
  id: string;
  org_type: "distributor" | "surgeon";
  distributor_id: string | null;
  surgeon_id: string | null;
  role: PortalRole;
}

export interface PortalAuthOk {
  ok: true;
  userId: string;
  email: string | null;
  portalUserId: string;
  memberships: PortalMembership[];
  surgeonIds: string[];
  distributorIds: string[];
  supabaseAdmin: ReturnType<typeof createClient>;
}


export interface PortalAuthErr {
  ok: false;
  response: Response;
}

export type PortalAuthResult = PortalAuthOk | PortalAuthErr;

function fail(status: number, error: string): PortalAuthErr {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  };
}

/** Decode the JWT and read its `aal` claim. Stateless-safe (same approach as admin-auth). */
export function jwtHasAal2(authHeader: string | null): boolean {
  try {
    if (!authHeader?.startsWith("Bearer ")) return false;
    const parts = authHeader.slice(7).split(".");
    if (parts.length < 2) return false;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded))?.aal === "aal2";
  } catch {
    return false;
  }
}

export interface RequirePortalOpts {
  /** Require the caller to hold at least one of these roles. */
  anyRole?: PortalRole[];
  /** Require the caller's scope to include this clinic. */
  clinicId?: string;
  /** Require the caller's scope to include this distributor. */
  distributorId?: string;
  /** Step-up MFA — used for money-moving actions such as connecting a merchant account. */
  requireAal2?: boolean;
}

export async function requirePortalUser(
  req: Request,
  opts: RequirePortalOpts = {},
): Promise<PortalAuthResult> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return fail(401, "Unauthorized");

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return fail(401, "Unauthorized");
  const user = userData.user;

  const supabaseAdmin = createClient(url, service);

  const { data: portalUser } = await supabaseAdmin
    .from("portal_users")
    .select("id, is_active, accepted_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!portalUser || !portalUser.is_active || !portalUser.accepted_at) {
    return fail(403, "Portal access required");
  }

  const { data: membershipRows } = await supabaseAdmin
    .from("portal_memberships")
    .select("id, org_type, distributor_id, clinic_id, role")
    .eq("portal_user_id", portalUser.id)
    .eq("is_active", true)
    .is("revoked_at", null);

  const memberships = (membershipRows ?? []) as PortalMembership[];
  if (memberships.length === 0) return fail(403, "No active portal membership");

  const distributorIds = memberships
    .filter((m) => m.org_type === "distributor" && m.distributor_id)
    .map((m) => m.distributor_id as string);

  // Clinic scope = direct clinic memberships + clinics reachable via distributor
  // assignment or distributor region coverage. Mirrors private.portal_scope_clinic_ids.
  const clinicIdSet = new Set<string>(
    memberships.filter((m) => m.org_type === "clinic" && m.clinic_id).map((m) => m.clinic_id as string),
  );

  if (distributorIds.length > 0) {
    const { data: assigned } = await supabaseAdmin
      .from("clinic_distributors")
      .select("clinic_id")
      .in("distributor_id", distributorIds);
    for (const row of assigned ?? []) clinicIdSet.add(row.clinic_id as string);

    const { data: regionRows } = await supabaseAdmin
      .from("distributor_regions")
      .select("region_id")
      .in("distributor_id", distributorIds);
    const regionIds = (regionRows ?? []).map((r) => r.region_id as string);

    if (regionIds.length > 0) {
      const { data: regionClinics } = await supabaseAdmin
        .from("clinics")
        .select("id")
        .in("region_id", regionIds);
      for (const row of regionClinics ?? []) clinicIdSet.add(row.id as string);
    }
  }

  const clinicIds = [...clinicIdSet];

  if (opts.anyRole && !memberships.some((m) => opts.anyRole!.includes(m.role))) {
    return fail(403, "Insufficient portal role");
  }
  if (opts.clinicId && !clinicIds.includes(opts.clinicId)) {
    return fail(403, "Clinic is outside your scope");
  }
  if (opts.distributorId && !distributorIds.includes(opts.distributorId)) {
    return fail(403, "Distributor is outside your scope");
  }
  if (opts.requireAal2 && !jwtHasAal2(authHeader)) {
    return fail(401, "MFA required");
  }

  return {
    ok: true,
    userId: user.id,
    email: user.email ?? null,
    portalUserId: portalUser.id as string,
    memberships,
    clinicIds,
    distributorIds,
    supabaseAdmin,
  };
}
