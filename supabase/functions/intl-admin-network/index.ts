// INTERNATIONAL-ONLY admin network surface.
//
// Powers the "Network" screen of the International hub: which surgeons came
// from Zoho, which distributor oversees each of them, who has portal access
// and whether a payment account is connected.
//
// Reads   : Himplant admin (or super admin) + AAL2.
// Mutations: Himplant SUPER ADMIN + AAL2 only.
//
// Touches no U.S. enrollment/payment/credit table and never returns any
// credential material.
import { requireAdmin } from "../_shared/admin-auth.ts";
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

const SUPPORTED_COUNTRIES = ["MX", "CO", "CL"];

const isUuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const flagBlock = await requireIntlEnabled();
  if (flagBlock) return flagBlock;

  const auth = await requireAdmin(req, { requireAal2: true });
  if (!auth.ok) return auth.response;
  const db = auth.supabaseAdmin;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "status");

    const { data: adminRow } = await db
      .from("admin_users")
      .select("id, role")
      .eq("user_id", auth.userId)
      .maybeSingle();
    const adminRole = (adminRow as { role?: string } | null)?.role ?? null;
    const adminRowId = (adminRow as { id?: string } | null)?.id ?? null;

    // ------------------------------------------------------------------
    // Mutations — super admin only. Ops admins may read the network but must
    // never be able to re-wire who oversees a surgeon.
    // ------------------------------------------------------------------
    if (action !== "status") {
      if (adminRole !== "super_admin") {
        return json({ error: "Super admin access required" }, 403);
      }

      const audit = async (a: string, resourceId: string | null, summary: unknown) => {
        await db.from("admin_audit_log").insert({
          admin_user_id: auth.userId,
          admin_email: auth.email,
          action: a,
          resource_type: "intl_network",
          resource_id: resourceId,
          resource_summary: summary as Record<string, unknown>,
        });
      };

      // ---- Assign / unassign a surgeon's single distributor --------------
      if (action === "assign_surgeon_distributor") {
        const surgeonId = body.surgeon_id;
        const distributorId = body.distributor_id ?? null;
        if (!isUuid(surgeonId)) return json({ error: "A valid surgeon is required" }, 400);
        if (distributorId !== null && !isUuid(distributorId)) {
          return json({ error: "A valid distributor is required" }, 400);
        }

        const { data: surgeon } = await db
          .from("surgeons")
          .select("id, name, country, is_international")
          .eq("id", surgeonId as string)
          .maybeSingle();
        if (!surgeon) return json({ error: "Surgeon not found" }, 404);
        if (!surgeon.is_international) {
          return json({ error: "Only international surgeons can be assigned a distributor" }, 400);
        }

        let distributor: { id: string; name: string; countries: string[]; is_active: boolean } | null = null;
        if (distributorId) {
          const { data } = await db
            .from("distributors")
            .select("id, name, countries, is_active")
            .eq("id", distributorId as string)
            .maybeSingle();
          distributor = data as typeof distributor;
          if (!distributor) return json({ error: "Distributor not found" }, 404);
          if (!distributor.is_active) return json({ error: "That distributor is inactive" }, 400);
        }

        // Singular model: one row per surgeon, enforced by a unique index on
        // distributor_surgeons(surgeon_id). Assign is an atomic upsert so a
        // failure can never leave the surgeon temporarily unassigned.
        const { data: existing } = await db
          .from("distributor_surgeons")
          .select("id, distributor_id")
          .eq("surgeon_id", surgeonId as string);

        if (distributor) {
          const { error: upErr } = await db
            .from("distributor_surgeons")
            .upsert(
              { surgeon_id: surgeonId as string, distributor_id: distributor.id },
              { onConflict: "surgeon_id" },
            );
          if (upErr) return json({ error: upErr.message }, 400);
        } else {
          // Explicit unassign removes the surgeon's mapping.
          const { error: delErr } = await db
            .from("distributor_surgeons")
            .delete()
            .eq("surgeon_id", surgeonId as string);
          if (delErr) return json({ error: delErr.message }, 400);
        }

        await audit("intl_assign_surgeon_distributor", surgeonId as string, {
          surgeon: surgeon.name,
          previous_distributor_ids: (existing ?? []).map((r) => r.distributor_id),
          distributor_id: distributor?.id ?? null,
          distributor: distributor?.name ?? null,
          country_match: distributor
            ? (distributor.countries ?? []).includes(String(surgeon.country ?? ""))
            : null,
        });

        return json({
          ok: true,
          replaced: (existing ?? []).length,
          country_match: distributor
            ? (distributor.countries ?? []).includes(String(surgeon.country ?? ""))
            : null,
        });
      }

      // ---- Create / update a distributor ---------------------------------
      if (action === "save_distributor") {
        const id = body.id ?? null;
        if (id !== null && !isUuid(id)) return json({ error: "Invalid distributor" }, 400);

        const name = String(body.name ?? "").trim();
        if (!name) return json({ error: "Name is required" }, 400);

        const rawCountries = Array.isArray(body.countries) ? body.countries : [];
        const countries = [...new Set(rawCountries.map((c) => String(c).toUpperCase()))];
        if (countries.length === 0) return json({ error: "At least one country is required" }, 400);
        const invalid = countries.filter((c) => !SUPPORTED_COUNTRIES.includes(c));
        if (invalid.length) return json({ error: `Unsupported country: ${invalid.join(", ")}` }, 400);

        const payload = {
          name,
          legal_name: body.legal_name ? String(body.legal_name).trim() || null : null,
          countries,
          primary_contact_email: body.primary_contact_email
            ? String(body.primary_contact_email).trim().toLowerCase() || null
            : null,
          primary_contact_phone: body.primary_contact_phone
            ? String(body.primary_contact_phone).trim() || null
            : null,
          is_active: body.is_active === undefined ? true : !!body.is_active,
        };

        if (id) {
          const { error } = await db.from("distributors").update(payload).eq("id", id as string);
          if (error) return json({ error: error.message }, 400);
          await audit("intl_update_distributor", id as string, payload);
          return json({ ok: true, id });
        }

        const { data: inserted, error } = await db
          .from("distributors")
          .insert(payload)
          .select("id")
          .maybeSingle();
        if (error) return json({ error: error.message }, 400);
        await audit("intl_create_distributor", (inserted?.id as string) ?? null, payload);
        return json({ ok: true, id: inserted?.id ?? null });
      }

      return json({ error: "Unknown action" }, 400);
    }

    // ------------------------------------------------------------------
    // Read — the whole network in one payload.
    // ------------------------------------------------------------------
    if (adminRole !== "admin" && adminRole !== "super_admin") {
      return json({ error: "Admin access required" }, 403);
    }

    const [
      { data: surgeons },
      { data: distributors },
      { data: assignments },
      { data: memberships },
      { data: providerAccounts },
      { data: countrySettings },
      { data: policies },
    ] = await Promise.all([
      db
        .from("surgeons")
        .select(
          "id, name, email, country, city, is_international, is_active, consultation_fee_minor, currency, active_provider",
        )
        .eq("is_international", true)
        .order("name"),
      db
        .from("distributors")
        .select("id, name, legal_name, countries, primary_contact_email, primary_contact_phone, is_active")
        .order("name"),
      db.from("distributor_surgeons").select("surgeon_id, distributor_id"),
      db
        .from("portal_memberships")
        .select(
          "id, org_type, surgeon_id, distributor_id, role, is_active, revoked_at, portal_user:portal_users(id, email, full_name, accepted_at, is_active, last_login_at)",
        )
        .eq("is_active", true)
        .is("revoked_at", null),
      db
        .from("provider_accounts")
        .select("id, surgeon_id, provider, status, is_active, live_mode, environment, country"),
      db.from("international_country_settings").select("country, is_enabled, allowed_providers, default_currency"),
      db
        .from("international_policies")
        .select("id, country, surgeon_id, is_active")
        .eq("is_active", true),
    ]);

    return json({
      admin_role: adminRole,
      admin_user_id: adminRowId,
      surgeons: surgeons ?? [],
      distributors: distributors ?? [],
      assignments: assignments ?? [],
      memberships: memberships ?? [],
      provider_accounts: providerAccounts ?? [],
      country_settings: countrySettings ?? [],
      policies: policies ?? [],
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
