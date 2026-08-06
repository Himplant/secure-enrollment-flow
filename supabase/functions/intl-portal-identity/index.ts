// International portal IDENTITY lifecycle.
//
// This is the ONLY way portal identities are created. Nothing here touches the
// U.S. enrollment tables, U.S. functions, or the Himplant admin auth path.
// Every write runs with the service role after the caller has been validated
// as either (a) an accepted Himplant admin with AAL2, or (b) the authenticated
// invitee accepting their own invitation.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SURGEON_ROLES = ["surgeon_admin", "surgeon_staff", "surgeon_analyst"];
const DISTRIBUTOR_ROLES = ["distributor_admin", "distributor_staff", "distributor_analyst"];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = () => createClient(SUPABASE_URL, SERVICE_KEY);

function appUrl(): string {
  return (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
}

async function audit(
  db: ReturnType<typeof createClient>,
  entry: {
    action: string;
    entityId?: string | null;
    actorId?: string | null;
    summary?: Record<string, unknown>;
    status?: number;
    error?: string | null;
  },
) {
  try {
    await db.from("integration_audit_logs").insert({
      integration: "portal_identity",
      direction: "outbound",
      entity_type: "portal_user",
      entity_id: entry.entityId ?? null,
      request_summary: { action: entry.action, ...(entry.summary ?? {}) },
      response_status: entry.status ?? 200,
      error: entry.error ?? null,
      actor_id: entry.actorId ?? null,
    });
  } catch (_e) {
    // Audit failures must never break the lifecycle action.
  }
}

/** Sends the Supabase Auth invitation (or a recovery link for existing users). */
async function sendInvitation(
  db: ReturnType<typeof createClient>,
  email: string,
): Promise<{ sent: boolean; mode: "invite" | "existing_user"; error?: string }> {
  const redirectTo = `${appUrl()}/portal/accept-invite`;
  const { error } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { portal_user: true },
  });
  if (!error) return { sent: true, mode: "invite" };

  // Already has an auth identity (e.g. adding a second membership): the user
  // signs in normally, or uses forgot-password. No new auth user is created.
  const msg = error.message ?? "";
  if (/already been registered|already exists|email_exists/i.test(msg)) {
    return { sent: false, mode: "existing_user" };
  }
  return { sent: false, mode: "invite", error: msg };
}

/** Blocks any attempt to give a Himplant admin account a portal identity. */
async function isAdminEmail(db: ReturnType<typeof createClient>, email: string) {
  const { data } = await db.from("admin_users").select("id").ilike("email", email).maybeSingle();
  return !!data;
}

async function listIdentities(db: ReturnType<typeof createClient>) {
  const { data: users } = await db
    .from("portal_users")
    .select("id, email, full_name, is_active, mfa_required, invited_at, accepted_at, last_login_at")
    .order("created_at", { ascending: false });

  const { data: memberships } = await db
    .from("portal_memberships")
    .select(
      "id, portal_user_id, org_type, role, is_active, revoked_at, granted_at, surgeon_id, distributor_id",
    );

  const { data: surgeons } = await db.from("surgeons").select("id, name");
  const { data: distributors } = await db.from("distributors").select("id, name");

  const sMap = Object.fromEntries((surgeons ?? []).map((s) => [s.id, s.name]));
  const dMap = Object.fromEntries((distributors ?? []).map((d) => [d.id, d.name]));

  return json({
    users: (users ?? []).map((u) => ({
      ...u,
      status: u.accepted_at ? (u.is_active ? "active" : "disabled") : "invited",
      memberships: (memberships ?? [])
        .filter((m) => m.portal_user_id === u.id)
        .map((m) => ({
          id: m.id,
          org_type: m.org_type,
          role: m.role,
          is_active: m.is_active && !m.revoked_at,
          granted_at: m.granted_at,
          surgeon_id: m.surgeon_id,
          distributor_id: m.distributor_id,
          org_name: m.org_type === "surgeon"
            ? sMap[m.surgeon_id as string] ?? "Unknown surgeon"
            : dMap[m.distributor_id as string] ?? "Unknown distributor",
        })),
    })),
    surgeons: surgeons ?? [],
    distributors: distributors ?? [],
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const db = admin();

    // ---------------------------------------------------------------- accept
    // The invitee themselves: binds their auth user to the pending portal row.
    if (action === "accept_invite" || action === "touch_login") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user?.email) return json({ error: "Unauthorized" }, 401);
      const user = userData.user;
      const email = user.email!.toLowerCase();

      if (await isAdminEmail(db, email)) {
        return json({ error: "This account uses the Himplant admin console" }, 409);
      }

      // Bind strictly on the authenticated email — never on a client-supplied id.
      let { data: portalUser } = await db
        .from("portal_users")
        .select("id, accepted_at, is_active")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!portalUser) {
        const { data: byEmail } = await db
          .from("portal_users")
          .select("id, accepted_at, is_active, user_id")
          .ilike("email", email)
          .maybeSingle();
        if (!byEmail) return json({ error: "No portal invitation exists for this email" }, 404);
        if (byEmail.user_id && byEmail.user_id !== user.id) {
          return json({ error: "This invitation is bound to another account" }, 409);
        }
        portalUser = byEmail;
      }

      const patch: Record<string, unknown> = {
        user_id: user.id,
        last_login_at: new Date().toISOString(),
      };
      if (action === "accept_invite" && !portalUser.accepted_at) {
        patch.accepted_at = new Date().toISOString();
      }

      const { error: updErr } = await db
        .from("portal_users")
        .update(patch)
        .eq("id", portalUser.id as string);
      if (updErr) return json({ error: updErr.message }, 400);

      await audit(db, {
        action,
        entityId: portalUser.id as string,
        actorId: user.id,
        summary: { email },
      });

      return json({ ok: true, accepted: true });
    }

    // ------------------------------------------------------------ admin-only
    const auth = await requireAdmin(req, { requireAal2: true });
    if (!auth.ok) return auth.response;
    const actorId = auth.userId;

    if (action === "list") return await listIdentities(db);

    if (action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const fullName = body.full_name ? String(body.full_name).trim().slice(0, 200) : null;
      const orgType = String(body.org_type ?? "surgeon");
      const role = String(body.role ?? "");
      const surgeonId = body.surgeon_id ? String(body.surgeon_id) : null;
      const distributorId = body.distributor_id ? String(body.distributor_id) : null;

      if (!EMAIL_RE.test(email)) return json({ error: "A valid email is required" }, 400);
      if (orgType !== "surgeon" && orgType !== "distributor") {
        return json({ error: "Invalid organisation type" }, 400);
      }
      const allowed = orgType === "surgeon" ? SURGEON_ROLES : DISTRIBUTOR_ROLES;
      if (!allowed.includes(role)) return json({ error: "Invalid role" }, 400);
      if (orgType === "surgeon" && !surgeonId) return json({ error: "Select a surgeon" }, 400);
      if (orgType === "distributor" && !distributorId) {
        return json({ error: "Select a distributor" }, 400);
      }
      if (await isAdminEmail(db, email)) {
        return json({ error: "This email belongs to a Himplant admin account" }, 409);
      }

      let { data: portalUser } = await db
        .from("portal_users")
        .select("id, accepted_at")
        .ilike("email", email)
        .maybeSingle();

      if (!portalUser) {
        const { data: created, error } = await db
          .from("portal_users")
          .insert({
            email,
            full_name: fullName,
            is_active: true,
            mfa_required: role.endsWith("_admin"),
            invited_by: actorId,
          })
          .select("id, accepted_at")
          .single();
        if (error) return json({ error: error.message }, 400);
        portalUser = created;
      } else if (fullName) {
        await db.from("portal_users").update({ full_name: fullName }).eq("id", portalUser.id);
      }

      const match = orgType === "surgeon"
        ? { org_type: "surgeon", surgeon_id: surgeonId }
        : { org_type: "distributor", distributor_id: distributorId };

      const { data: existing } = await db
        .from("portal_memberships")
        .select("id")
        .eq("portal_user_id", portalUser!.id as string)
        .match(match)
        .maybeSingle();

      if (existing) {
        const { error } = await db
          .from("portal_memberships")
          .update({ role, is_active: true, revoked_at: null })
          .eq("id", existing.id as string);
        if (error) return json({ error: error.message }, 400);
      } else {
        const { error } = await db.from("portal_memberships").insert({
          portal_user_id: portalUser!.id,
          org_type: orgType,
          surgeon_id: surgeonId,
          distributor_id: distributorId,
          role,
          is_active: true,
          granted_by: actorId,
        });
        if (error) return json({ error: error.message }, 400);
      }

      let invite = { sent: false, mode: "existing_user" as const, error: undefined as
        | string
        | undefined };
      if (!portalUser!.accepted_at) {
        invite = await sendInvitation(db, email) as typeof invite;
      }

      await audit(db, {
        action: "invite",
        entityId: portalUser!.id as string,
        actorId,
        summary: { email, org_type: orgType, role, invite_mode: invite.mode },
      });

      const res = await listIdentities(db);
      const payload = await res.json();
      return json({ ...payload, invite });
    }

    if (action === "resend_invite") {
      const portalUserId = String(body.portal_user_id ?? "");
      const { data: pu } = await db
        .from("portal_users")
        .select("id, email, accepted_at")
        .eq("id", portalUserId)
        .maybeSingle();
      if (!pu) return json({ error: "Portal user not found" }, 404);
      if (pu.accepted_at) return json({ error: "This user has already accepted" }, 409);

      const invite = await sendInvitation(db, String(pu.email).toLowerCase());
      await db.from("portal_users").update({ invited_at: new Date().toISOString() }).eq("id", pu.id);
      await audit(db, {
        action: "resend_invite",
        entityId: pu.id as string,
        actorId,
        summary: { email: pu.email, invite_mode: invite.mode },
      });
      return json({ ok: true, invite });
    }

    if (action === "set_membership_active" || action === "set_membership_role") {
      const membershipId = String(body.membership_id ?? "");
      const { data: membership } = await db
        .from("portal_memberships")
        .select("id, org_type, role, portal_user_id")
        .eq("id", membershipId)
        .maybeSingle();
      if (!membership) return json({ error: "Membership not found" }, 404);

      const patch: Record<string, unknown> = {};
      if (action === "set_membership_active") {
        const active = body.is_active === true;
        patch.is_active = active;
        patch.revoked_at = active ? null : new Date().toISOString();
      } else {
        const role = String(body.role ?? "");
        const allowed = membership.org_type === "surgeon" ? SURGEON_ROLES : DISTRIBUTOR_ROLES;
        if (!allowed.includes(role)) return json({ error: "Invalid role" }, 400);
        patch.role = role;
      }

      const { error } = await db.from("portal_memberships").update(patch).eq("id", membershipId);
      if (error) return json({ error: error.message }, 400);

      // Deactivate the account only once no active memberships remain.
      const { data: remaining } = await db
        .from("portal_memberships")
        .select("id")
        .eq("portal_user_id", membership.portal_user_id as string)
        .eq("is_active", true)
        .is("revoked_at", null);
      await db
        .from("portal_users")
        .update({ is_active: (remaining ?? []).length > 0 })
        .eq("id", membership.portal_user_id as string);

      await audit(db, {
        action,
        entityId: membership.portal_user_id as string,
        actorId,
        summary: { membership_id: membershipId, ...patch },
      });
      return await listIdentities(db);
    }

    if (action === "remove_membership") {
      const membershipId = String(body.membership_id ?? "");
      const { data: membership } = await db
        .from("portal_memberships")
        .select("id, portal_user_id")
        .eq("id", membershipId)
        .maybeSingle();
      if (!membership) return json({ error: "Membership not found" }, 404);

      const { error } = await db.from("portal_memberships").delete().eq("id", membershipId);
      if (error) return json({ error: error.message }, 400);

      const { data: remaining } = await db
        .from("portal_memberships")
        .select("id")
        .eq("portal_user_id", membership.portal_user_id as string)
        .eq("is_active", true)
        .is("revoked_at", null);
      // The Supabase Auth identity is deliberately left in place.
      await db
        .from("portal_users")
        .update({ is_active: (remaining ?? []).length > 0 })
        .eq("id", membership.portal_user_id as string);

      await audit(db, {
        action: "remove_membership",
        entityId: membership.portal_user_id as string,
        actorId,
        summary: { membership_id: membershipId },
      });
      return await listIdentities(db);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
