// Surgeon-admin team management for the external portal.
//
// A surgeon_admin may invite, re-role and deactivate office staff for their
// OWN practice only. Every surgeon id in the request is re-derived from the
// caller's memberships server-side; nothing in the request body can widen
// scope. Himplant admin users are never touched by this endpoint.
import { requirePortalUser } from "../_shared/portal-auth.ts";
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

const ASSIGNABLE_ROLES = ["surgeon_admin", "surgeon_staff", "surgeon_analyst"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const flagBlock = await requireIntlEnabled();
    if (flagBlock) return flagBlock;

    const auth = await requirePortalUser(req, { anyRole: ["surgeon_admin"] });
    if (!auth.ok) return auth.response;

    // Practices this caller actually administers.
    const ownedSurgeonIds = auth.memberships
      .filter((m) => m.org_type === "surgeon" && m.role === "surgeon_admin" && m.surgeon_id)
      .map((m) => m.surgeon_id as string);

    if (ownedSurgeonIds.length === 0) return json({ error: "No practice on this account" }, 403);

    const admin = auth.supabaseAdmin;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "list");

    const resolveSurgeonId = (): string | null => {
      const requested = body.surgeon_id ? String(body.surgeon_id) : ownedSurgeonIds[0];
      return ownedSurgeonIds.includes(requested) ? requested : null;
    };

    const listTeam = async () => {
      const { data: memberships } = await admin
        .from("portal_memberships")
        .select("id, role, is_active, surgeon_id, granted_at, revoked_at, portal_user_id")
        .eq("org_type", "surgeon")
        .in("surgeon_id", ownedSurgeonIds)
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

      const { data: surgeons } = await admin
        .from("surgeons")
        .select("id, name")
        .in("id", ownedSurgeonIds);

      return json({
        surgeons: surgeons ?? [],
        members: rows.map((m) => ({
          membership_id: m.id,
          surgeon_id: m.surgeon_id,
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
      const surgeonId = resolveSurgeonId();
      if (!surgeonId) return json({ error: "Practice is outside your scope" }, 403);

      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(body.role ?? "surgeon_staff") as AssignableRole;
      const fullName = body.full_name ? String(body.full_name).trim().slice(0, 200) : null;

      if (!EMAIL_RE.test(email)) return json({ error: "A valid email is required" }, 400);
      if (!ASSIGNABLE_ROLES.includes(role)) return json({ error: "Invalid role" }, 400);

      // Never let a practice grant portal access to a Himplant staff account.
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
            mfa_required: role === "surgeon_admin",
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
        .eq("org_type", "surgeon")
        .eq("surgeon_id", surgeonId)
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
          org_type: "surgeon",
          surgeon_id: surgeonId,
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
        .select("id, surgeon_id, org_type, portal_user_id, role")
        .eq("id", membershipId)
        .maybeSingle();

      if (
        !membership || membership.org_type !== "surgeon" ||
        !ownedSurgeonIds.includes(membership.surgeon_id as string)
      ) {
        return json({ error: "Team member not found" }, 404);
      }

      // A surgeon admin cannot lock themselves out of their own practice.
      if (
        membership.portal_user_id === auth.portalUserId &&
        (action === "deactivate" || (action === "set_role" && body.role !== "surgeon_admin"))
      ) {
        return json({ error: "You cannot change your own access" }, 409);
      }

      const patch: Record<string, unknown> = {};
      if (action === "deactivate") {
        patch.is_active = false;
        patch.revoked_at = new Date().toISOString();
      } else if (action === "reactivate") {
        patch.is_active = true;
        patch.revoked_at = null;
      } else {
        const role = String(body.role ?? "") as AssignableRole;
        if (!ASSIGNABLE_ROLES.includes(role)) return json({ error: "Invalid role" }, 400);
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
