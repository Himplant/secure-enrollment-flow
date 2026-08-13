// Portal Test Center backend — INTERNATIONAL QA ONLY.
//
// Hard safety rules baked in:
//   * Himplant super_admin + AAL2 only.
//   * Refuses unless the runtime flag `international_portal_qa_enabled` is on.
//   * Every record it creates is registered in public.intl_qa_fixture_records.
//     Cleanup can ONLY delete rows present in that registry, plus auth users
//     carrying app_metadata.intl_qa_demo = true.
//   * It never touches U.S. tables (enrollments, patients, surgeon_credits, ...).
//   * Temporary passwords are accepted, used, and never returned or logged.
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

const FIXTURE_SET = "intl-qa-default";

/** Tables the cleanup routine is ever allowed to delete from. */
const CLEANABLE_TABLES = [
  "consultations",
  "consultation_patients",
  "provider_accounts",
  "distributor_surgeons",
  "portal_memberships",
  "portal_users",
  "surgeons",
  "distributors",
] as const;

export const QA_DEMO_USERS = [
  {
    email: "qa.multi.admin@himplant.com",
    full_name: "QA Multi Admin",
    memberships: [
      { org: "distributor", role: "distributor_admin" },
      { org: "surgeonA", role: "surgeon_admin" },
    ],
  },
  {
    email: "qa.surgeon.staff@himplant.com",
    full_name: "QA Surgeon Staff",
    memberships: [{ org: "surgeonA", role: "surgeon_staff" }],
  },
  {
    email: "qa.surgeon.analyst@himplant.com",
    full_name: "QA Surgeon Analyst",
    memberships: [{ org: "surgeonA", role: "surgeon_analyst" }],
  },
  {
    email: "qa.distributor.staff@himplant.com",
    full_name: "QA Distributor Staff",
    memberships: [{ org: "distributor", role: "distributor_staff" }],
  },
  {
    email: "qa.distributor.analyst@himplant.com",
    full_name: "QA Distributor Analyst",
    memberships: [{ org: "distributor", role: "distributor_analyst" }],
  },
] as const;

const SURGEON_FIXTURES = [
  { key: "surgeonA", name: "QA Surgeon Colombia A", zoho_id: "QA-SURG-A", mapped: true },
  { key: "surgeonB", name: "QA Surgeon Colombia B", zoho_id: "QA-SURG-B", mapped: true },
  { key: "surgeonU", name: "QA Unmapped Surgeon Colombia", zoho_id: "QA-SURG-U", mapped: false },
] as const;

/** Display-only consultation states, all reachable through the test provider. */
const CONSULTATION_FIXTURES = [
  { payment: "link_sent", consultation: "awaiting_payment", surgery: "none" },
  { payment: "link_opened", consultation: "awaiting_payment", surgery: "none" },
  { payment: "processing", consultation: "awaiting_payment", surgery: "none" },
  { payment: "approved", consultation: "awaiting_clinic_contact", surgery: "none" },
  { payment: "approved", consultation: "patient_contacted", surgery: "none" },
  { payment: "approved", consultation: "scheduled", surgery: "none" },
  { payment: "approved", consultation: "rescheduled", surgery: "none" },
  { payment: "approved", consultation: "no_show", surgery: "none" },
  { payment: "approved", consultation: "completed", surgery: "recommended" },
  { payment: "approved", consultation: "completed", surgery: "scheduled" },
  { payment: "approved", consultation: "completed", surgery: "completed" },
  { payment: "failed", consultation: "awaiting_payment", surgery: "none" },
  { payment: "refunded", consultation: "closed_lost", surgery: "none" },
  { payment: "disputed", consultation: "closed_lost", surgery: "none" },
] as const;

type Db = Awaited<ReturnType<typeof requireAdmin>> extends { supabaseAdmin: infer T } ? T : never;

// deno-lint-ignore no-explicit-any
async function register(db: any, table: string, recordId: string) {
  await db
    .from("intl_qa_fixture_records")
    .upsert(
      { fixture_set_id: FIXTURE_SET, table_name: table, record_id: recordId },
      { onConflict: "table_name,record_id" },
    );
}

async function randomToken(): Promise<{ hash: string; last4: string }> {
  const raw = crypto.randomUUID().replace(/-/g, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { hash, last4: raw.slice(-4) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAdmin(req, { requireAal2: true });
  if (!auth.ok) return auth.response;
  // deno-lint-ignore no-explicit-any
  const db = auth.supabaseAdmin as any;

  try {
    // --- Super admin only -------------------------------------------------
    const { data: adminRow } = await db
      .from("admin_users")
      .select("role")
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (adminRow?.role !== "super_admin") {
      return json({ error: "Super admin access required" }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "status");

    // --- QA flag gate (status is readable so the UI can explain itself) ----
    const { data: flagRow } = await db
      .from("app_feature_flags")
      .select("enabled")
      .eq("key", "international_portal_qa_enabled")
      .maybeSingle();
    const qaEnabled = !!flagRow?.enabled;

    if (action !== "status" && !qaEnabled) {
      return json(
        { error: "Portal Test Center is disabled. Enable 'international_portal_qa_enabled' first." },
        403,
      );
    }

    const loadStatus = async () => {
      const { data: registry } = await db
        .from("intl_qa_fixture_records")
        .select("table_name, record_id")
        .eq("fixture_set_id", FIXTURE_SET);

      const counts: Record<string, number> = {};
      for (const r of registry ?? []) {
        counts[r.table_name as string] = (counts[r.table_name as string] ?? 0) + 1;
      }

      const emails = QA_DEMO_USERS.map((u) => u.email);
      const { data: users } = await db
        .from("portal_users")
        .select("id, email, full_name, is_active, accepted_at, last_login_at")
        .in("email", emails);

      // Organisation names are included so the tester can see exactly which
      // workspace each demo identity lands in.
      const { data: memberships } = await db
        .from("portal_memberships")
        .select("portal_user_id, org_type, role, is_active, surgeons(name), distributors(name)")
        .in("portal_user_id", (users ?? []).map((u: { id: string }) => u.id));

      return json({
        qa_enabled: qaEnabled,
        fixture_set_id: FIXTURE_SET,
        counts,
        demo_users: emails.map((email) => {
          const u = (users ?? []).find((x: { email: string }) => x.email === email) ?? null;
          return {
            email,
            exists: !!u,
            is_active: u?.is_active ?? false,
            accepted: !!u?.accepted_at,
            last_login_at: u?.last_login_at ?? null,
            memberships: (memberships ?? [])
              .filter((m: { portal_user_id: string }) => m.portal_user_id === u?.id)
              .map((m: Record<string, unknown>) => ({
                org_type: m.org_type as string,
                role: m.role as string,
                is_active: m.is_active as boolean,
                org_name:
                  ((m.surgeons as { name?: string } | null)?.name ??
                    (m.distributors as { name?: string } | null)?.name) ?? null,
              })),
          };
        }),
      });

    };

    if (action === "status") return await loadStatus();

    // ------------------------------------------------------------------
    // Fixture data (idempotent, always tagged in the registry)
    // ------------------------------------------------------------------
    const ensureFixtures = async () => {
      // Distributor
      let { data: distributor } = await db
        .from("distributors")
        .select("id")
        .eq("name", "QA Colombia Distributor")
        .maybeSingle();
      if (!distributor) {
        const { data, error } = await db
          .from("distributors")
          .insert({
            name: "QA Colombia Distributor",
            legal_name: "QA Colombia Distributor SAS",
            primary_contact_email: "qa.distributor.staff@himplant.com",
            is_active: true,
            countries: ["CO"],
          })
          .select("id")
          .single();
        if (error) throw new Error(`distributor: ${error.message}`);
        distributor = data;
      }
      await register(db, "distributors", distributor.id);

      const surgeonIds: Record<string, string> = {};
      for (const s of SURGEON_FIXTURES) {
        let { data: row } = await db
          .from("surgeons")
          .select("id")
          .eq("zoho_id", s.zoho_id)
          .maybeSingle();
        if (!row) {
          const { data, error } = await db
            .from("surgeons")
            .insert({
              zoho_id: s.zoho_id,
              name: s.name,
              email: `${s.zoho_id.toLowerCase()}@himplant.com`,
              country: "CO",
              city: "Bogotá",
              is_active: true,
              is_international: true,
              consultation_fee_minor: 15000000,
              currency: "COP",
              timezone: "America/Bogota",
              active_provider: "test",
            })
            .select("id")
            .single();
          if (error) throw new Error(`surgeon ${s.key}: ${error.message}`);
          row = data;
        }
        surgeonIds[s.key] = row.id;
        await register(db, "surgeons", row.id);

        if (s.mapped) {
          const { data: link } = await db
            .from("distributor_surgeons")
            .select("id")
            .eq("distributor_id", distributor.id)
            .eq("surgeon_id", row.id)
            .maybeSingle();
          let linkId = link?.id;
          if (!linkId) {
            const { data: created, error } = await db
              .from("distributor_surgeons")
              .insert({ distributor_id: distributor.id, surgeon_id: row.id })
              .select("id")
              .single();
            if (error) throw new Error(`mapping ${s.key}: ${error.message}`);
            linkId = created.id;
          }
          await register(db, "distributor_surgeons", linkId);
        }

        // Test-provider account only — never a real merchant.
        const { data: acct } = await db
          .from("provider_accounts")
          .select("id")
          .eq("surgeon_id", row.id)
          .eq("provider", "test")
          .maybeSingle();
        let acctId = acct?.id;
        if (!acctId) {
          const { data: created, error } = await db
            .from("provider_accounts")
            .insert({
              surgeon_id: row.id,
              provider: "test",
              country: "CO",
              currency: "COP",
              environment: "sandbox",
              connection_method: "admin_managed",
              status: "connected",
              is_active: true,
              live_mode: false,
              external_merchant_id: `QA-${s.zoho_id}`,
            })
            .select("id")
            .single();
          if (error) throw new Error(`provider account ${s.key}: ${error.message}`);
          acctId = created.id;
        }
        await register(db, "provider_accounts", acctId);
      }

      // Consultations across QA surgeon A and B.
      const targets = [surgeonIds.surgeonA, surgeonIds.surgeonB];
      for (let i = 0; i < CONSULTATION_FIXTURES.length; i++) {
        const f = CONSULTATION_FIXTURES[i];
        const surgeonId = targets[i % targets.length];
        const patientName = `QA Patient ${String(i + 1).padStart(2, "0")}`;

        let { data: patient } = await db
          .from("consultation_patients")
          .select("id")
          .eq("full_name", patientName)
          .maybeSingle();
        if (!patient) {
          const { data, error } = await db
            .from("consultation_patients")
            .insert({
              full_name: patientName,
              email: `qa.patient.${i + 1}@example.com`,
              phone: `+5730000000${i}`,
              country: "CO",
              preferred_language: "es-CO",
              notes: "QA fixture — internal note that distributors must never see.",
            })
            .select("id")
            .single();
          if (error) throw new Error(`patient ${i}: ${error.message}`);
          patient = data;
        }
        await register(db, "consultation_patients", patient.id);

        const { data: existing } = await db
          .from("consultations")
          .select("id")
          .eq("patient_id", patient.id)
          .maybeSingle();
        if (existing) {
          await register(db, "consultations", existing.id);
          continue;
        }

        const { hash, last4 } = await randomToken();
        const now = Date.now();
        const paid = ["approved", "refunded", "disputed"].includes(f.payment);
        const { data: created, error } = await db
          .from("consultations")
          .insert({
            token_hash: hash,
            token_last4: last4,
            expires_at: new Date(now + 48 * 3600e3).toISOString(),
            surgeon_id: surgeonId,
            patient_id: patient.id,
            amount_minor: 15000000,
            currency: "COP",
            country: "CO",
            provider: "test",
            payment_status: f.payment,
            consultation_status: f.consultation,
            surgery_status: f.surgery,
            preferred_language: "es-CO",
            sent_at: new Date(now - 6 * 3600e3).toISOString(),
            paid_at: paid ? new Date(now - 5 * 3600e3).toISOString() : null,
            outcome_notes: "QA fixture outcome note — clinic-only.",
            notes: "QA fixture",
          })
          .select("id")
          .single();
        if (error) throw new Error(`consultation ${i}: ${error.message}`);
        await register(db, "consultations", created.id);
      }

      return { distributorId: distributor.id, surgeonIds };
    };

    if (action === "reset_fixtures") {
      await ensureFixtures();
      return await loadStatus();
    }

    // ------------------------------------------------------------------
    // Demo users — real Supabase Auth identities, real portal rows.
    // ------------------------------------------------------------------
    if (action === "create_demo_users") {
      const password = String(body.password ?? "");
      if (password.length < 12) {
        return json({ error: "Provide a temporary password of at least 12 characters" }, 400);
      }

      const { distributorId, surgeonIds } = await ensureFixtures();

      for (const spec of QA_DEMO_USERS) {
        // Auth identity
        const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existingAuth = (list?.users ?? []).find(
          (u: { email?: string }) => u.email?.toLowerCase() === spec.email,
        );

        let authUserId: string;
        if (existingAuth) {
          authUserId = existingAuth.id;
          await db.auth.admin.updateUserById(authUserId, {
            password,
            email_confirm: true,
            app_metadata: { ...(existingAuth.app_metadata ?? {}), intl_qa_demo: true },
          });
        } else {
          const { data: created, error } = await db.auth.admin.createUser({
            email: spec.email,
            password,
            email_confirm: true,
            app_metadata: { intl_qa_demo: true },
            user_metadata: { full_name: spec.full_name, portal_user: true },
          });
          if (error) return json({ error: `${spec.email}: ${error.message}` }, 400);
          authUserId = created.user.id;
        }

        // Portal user row
        let { data: pu } = await db
          .from("portal_users")
          .select("id")
          .ilike("email", spec.email)
          .maybeSingle();
        if (!pu) {
          const { data, error } = await db
            .from("portal_users")
            .insert({
              email: spec.email,
              full_name: spec.full_name,
              user_id: authUserId,
              is_active: true,
              mfa_required: false,
              accepted_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (error) return json({ error: `${spec.email}: ${error.message}` }, 400);
          pu = data;
        } else {
          await db
            .from("portal_users")
            .update({
              user_id: authUserId,
              is_active: true,
              accepted_at: new Date().toISOString(),
            })
            .eq("id", pu.id);
        }
        await register(db, "portal_users", pu.id);

        for (const m of spec.memberships) {
          const orgType = m.org === "distributor" ? "distributor" : "surgeon";
          const orgId = m.org === "distributor" ? distributorId : surgeonIds[m.org];
          const column = orgType === "distributor" ? "distributor_id" : "surgeon_id";

          const { data: existing } = await db
            .from("portal_memberships")
            .select("id")
            .eq("portal_user_id", pu.id)
            .eq("org_type", orgType)
            .eq(column, orgId)
            .maybeSingle();

          let membershipId = existing?.id;
          if (membershipId) {
            await db
              .from("portal_memberships")
              .update({ role: m.role, is_active: true, revoked_at: null })
              .eq("id", membershipId);
          } else {
            const { data: created, error } = await db
              .from("portal_memberships")
              .insert({
                portal_user_id: pu.id,
                org_type: orgType,
                [column]: orgId,
                role: m.role,
                is_active: true,
              })
              .select("id")
              .single();
            if (error) return json({ error: `${spec.email}: ${error.message}` }, 400);
            membershipId = created.id;
          }
          await register(db, "portal_memberships", membershipId);
        }
      }

      // The temporary password is never echoed back.
      return await loadStatus();
    }

    if (action === "disable_demo_users") {
      const emails = QA_DEMO_USERS.map((u) => u.email);
      const { data: users } = await db.from("portal_users").select("id").in("email", emails);
      const ids = (users ?? []).map((u: { id: string }) => u.id);
      if (ids.length) {
        await db
          .from("portal_memberships")
          .update({ is_active: false, revoked_at: new Date().toISOString() })
          .in("portal_user_id", ids);
        await db.from("portal_users").update({ is_active: false }).in("id", ids);
      }
      return await loadStatus();
    }

    if (action === "cleanup") {
      const { data: registry } = await db
        .from("intl_qa_fixture_records")
        .select("id, table_name, record_id")
        .eq("fixture_set_id", FIXTURE_SET);

      // Delete children before parents; only registered ids, only allowed tables.
      for (const table of CLEANABLE_TABLES) {
        const ids = (registry ?? [])
          .filter((r: { table_name: string }) => r.table_name === table)
          .map((r: { record_id: string }) => r.record_id);
        if (!ids.length) continue;
        const { error } = await db.from(table).delete().in("id", ids);
        if (error) return json({ error: `cleanup ${table}: ${error.message}` }, 400);
        await db
          .from("intl_qa_fixture_records")
          .delete()
          .eq("fixture_set_id", FIXTURE_SET)
          .eq("table_name", table);
      }

      // Auth users are removed only when explicitly tagged as QA demo accounts.
      const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      for (const u of list?.users ?? []) {
        if (u.app_metadata?.intl_qa_demo === true) {
          await db.auth.admin.deleteUser(u.id);
        }
      }

      return await loadStatus();
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
