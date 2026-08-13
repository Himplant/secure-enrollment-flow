// Team management for the external portal (surgeon practices AND distributors).
//
// A surgeon_admin manages office staff for their OWN practice; a
// distributor_admin manages staff for their OWN distributor. Every
// organisation id in the request is re-derived from the caller's memberships
// server-side, scoped to the ACTIVE workspace, so nothing in the request body
// can widen scope. Himplant admin users are never touched by this endpoint.
import { applyWorkspace, requirePortalUser } from "../_shared/portal-auth.ts";
import { requireIntlEnabled } from "../_shared/flags.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export const SURGEON_ROLES = ["surgeon_admin", "surgeon_staff", "surgeon_analyst"] as const;
export const DISTRIBUTOR_ROLES = [
  "distributor_admin",
  "distributor_staff",
  "distributor_analyst",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const flagBlock = await requireIntlEnabled();
    if (flagBlock) return flagBlock;

    const baseAuth = await requirePortalUser(req, {
      anyRole: ["surgeon_admin", "distributor_admin"],
    });
    if (!baseAuth.ok) return baseAuth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Narrow to the organisation the caller is currently acting as. Scope is
    // always recomputed from memberships, so this can only shrink access.
    const auth = await applyWorkspace(baseAuth, body);
    if (!auth.ok) return auth.response;

    const admin = auth.supabaseAdmin;

    // Which organisation type is this request about? Derived from the active
    // workspace when one was supplied, otherwise from the caller's own
    // admin memberships (single-workspace back-compat).
    const orgType: "surgeon" | "distributor" =
      body.workspace_org_type === "distributor"
        ? "distributor"
        : body.workspace_org_type === "surgeon"
        ? "surgeon"
        : auth.memberships.some((m) => m.role === "surgeon_admin")
        ? "surgeon"
        : "distributor";

    const adminRole = orgType === "surgeon" ? "surgeon_admin" : "distributor_admin";
    const assignableRoles: readonly string[] =
      orgType === "surgeon" ? SURGEON_ROLES : DISTRIBUTOR_ROLES;

    // The admin role must hold inside the ACTIVE workspace, not just somewhere.
    const ownedOrgIds = auth.memberships
      .filter((m) => m.org_type === orgType && m.role === adminRole)
      .map((m) => (orgType === "surgeon" ? m.surgeon_id : m.distributor_id))
      .filter((id): id is string => !!id);

    if (ownedOrgIds.length === 0) {
      return json({ error: "Insufficient portal role for this workspace" }, 403);
    }

    const orgColumn = orgType === "surgeon" ? "surgeon_id" : "distributor_id";
    const action = String(body.action ?? "list");

    const resolveOrgId = (): string | null => {
      const requested = body.org_id
        ? String(body.org_id)
        : body.surgeon_id
        ? String(body.surgeon_id)
        : ownedOrgIds[0];
      return ownedOrgIds.includes(requested) ? requested : null;
    };

    const listTeam = async () => {
      const { data: memberships } = await admin
        .from("portal_memberships")
        .select(
          "id, role, is_active, surgeon_id, distributor_id, granted_at, revoked_at, portal_user_id",
        )
        .eq("org_type", orgType)
        .in(orgColumn, ownedOrgIds)
        .order("granted_at", { ascending: true });

      const rows = memberships ?? [];
      const userIds = [...new Set(rows.map((m) => m.portal_user_id as string))];

      const { data: users } = userIds.length
        ? await admin
          .from("portal_users")
          .select("id, email, full_name, is_active, accepted_at, last_login_at")
          .in("id", userIds)
        : { data: [] as Record<string, unknown>[] };

      const userMap = Object.fromEntries((users ?? []).map((u) => [u.id as string, u]));

      const { data: orgs } = orgType === "surgeon"
        ? await admin.from("surgeons").select("id, name").in("id", ownedOrgIds)
        : await admin.from("distributors").select("id, name").in("id", ownedOrgIds);

      return json({
        org_type: orgType,
        assignable_roles: assignableRoles,
        organizations: orgs ?? [],
        // Legacy key kept so existing surgeon UI keeps working unchanged.
        surgeons: orgType === "surgeon" ? orgs ?? [] : [],
        members: rows.map((m) => ({
          membership_id: m.id,
          org_id: orgType === "surgeon" ? m.surgeon_id : m.distributor_id,
          surgeon_id: m.surgeon_id,
          distributor_id: m.distributor_id,
          role: m.role,
          is_active: m.is_active && !m.revoked_at,
          granted_at: m.granted_at,
          user: userMap[m.portal_user_id as string]
            ? {
              email: userMap[m.portal_user_id as string].email,
              full_name: userMap[m.portal_user_id as string].full_name,
              accepted_at: userMap[m.portal_user_id as string].accepted_at,
              last_login_at: userMap[m.portal_user_id as string].last_login_at,
            }
            : null,
        })),
      });
    };

    if (action === "list") return await listTeam();

    if (action === "invite") {
      const orgId = resolveOrgId();
      if (!orgId) return json({ error: "Organization is outside your scope" }, 403);

      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(
        body.role ?? (orgType === "surgeon" ? "surgeon_staff" : "distributor_staff"),
      );
      const fullName = body.full_name ? String(body.full_name).trim().slice(0, 200) : null;

      if (!EMAIL_RE.test(email)) return json({ error: "A valid email is required" }, 400);
      if (!assignableRoles.includes(role)) return json({ error: "Invalid role" }, 400);

      // Never let a portal organisation grant access to a Himplant staff account.
      const { data: isAdminUser } = await admin
        .from("admin_users")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      if (isAdminUser) return json({ error: "This email cannot be invited here" }, 409);

      let { data: portalUser } = await admin
        .from("portal_users")
        .select("id, accepted_at")
        .ilike("email", email)
        .maybeSingle();

      if (!portalUser) {
        const { data: created, error: createErr } = await admin
          .from("portal_users")
          .insert({
            email,
            full_name: fullName,
            is_active: true,
            mfa_required: role === adminRole,
            invited_by: auth.userId,
          })
          .select("id, accepted_at")
          .single();
        if (createErr) return json({ error: createErr.message }, 400);
        portalUser = created;
      }

      // Real Supabase Auth invitation — a database row alone never grants login.
      if (!portalUser!.accepted_at) {
        const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
        const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${appUrl}/portal/accept-invite`,
          data: { portal_user: true },
        });
        // An existing auth identity simply signs in / uses forgot-password.
        if (inviteErr && !/already been registered|already exists|email_exists/i.test(inviteErr.message ?? "")) {
          return json({ error: inviteErr.message }, 400);
        }
      }

      const { data: existing } = await admin
        .from("portal_memberships")
        .select("id")
        .eq("portal_user_id", portalUser!.id as string)
        .eq("org_type", orgType)
        .eq(orgColumn, orgId)
        .maybeSingle();

      if (existing) {
        const { error } = await admin
          .from("portal_memberships")
          .update({ role, is_active: true, revoked_at: null })
          .eq("id", existing.id as string);
        if (error) return json({ error: error.message }, 400);
      } else {
        const { error } = await admin.from("portal_memberships").insert({
          portal_user_id: portalUser!.id,
          org_type: orgType,
          [orgColumn]: orgId,
          role,
          is_active: true,
          granted_by: auth.userId,
        });
        if (error) return json({ error: error.message }, 400);
      }

      return await listTeam();
    }

    if (action === "set_role" || action === "deactivate" || action === "reactivate") {
      const membershipId = String(body.membership_id ?? "");
      if (!membershipId) return json({ error: "membership_id is required" }, 400);

      const { data: membership } = await admin
        .from("portal_memberships")
        .select("id, surgeon_id, distributor_id, org_type, portal_user_id, role")
        .eq("id", membershipId)
        .maybeSingle();

      const membershipOrgId = membership
        ? (orgType === "surgeon" ? membership.surgeon_id : membership.distributor_id) as string
        : null;

      if (
        !membership || membership.org_type !== orgType ||
        !membershipOrgId || !ownedOrgIds.includes(membershipOrgId)
      ) {
        return json({ error: "Team member not found" }, 404);
      }

      // An org admin cannot lock themselves out of their own organisation.
      if (
        membership.portal_user_id === auth.portalUserId &&
        (action === "deactivate" || (action === "set_role" && body.role !== adminRole))
      ) {
        return json({ error: "You cannot change your own access" }, 409);
      }

      // Never leave an organisation without an active admin.
      if (
        membership.role === adminRole &&
        (action === "deactivate" || (action === "set_role" && body.role !== adminRole))
      ) {
        const { data: admins } = await admin
          .from("portal_memberships")
          .select("id")
          .eq("org_type", orgType)
          .eq(orgColumn, membershipOrgId)
          .eq("role", adminRole)
          .eq("is_active", true)
          .is("revoked_at", null);
        if ((admins ?? []).length <= 1) {
          return json({ error: "This is the last administrator for this organization" }, 409);
        }
      }

      const patch: Record<string, unknown> = {};
      if (action === "deactivate") {
        patch.is_active = false;
        patch.revoked_at = new Date().toISOString();
      } else if (action === "reactivate") {
        patch.is_active = true;
        patch.revoked_at = null;
      } else {
        const role = String(body.role ?? "");
        if (!assignableRoles.includes(role)) return json({ error: "Invalid role" }, 400);
        patch.role = role;
      }

      const { error } = await admin
        .from("portal_memberships")
        .update(patch)
        .eq("id", membershipId);
      if (error) return json({ error: error.message }, 400);

      return await listTeam();
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
