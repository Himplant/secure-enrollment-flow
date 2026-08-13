// Read-only launch-readiness report for the INTERNATIONAL module.
//
// Himplant admin + AAL2 only. Returns statuses and "next action" hints for
// every gate that must be satisfied before a country can go live. It never
// returns credential values and never changes anything.
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

export type CheckStatus = "green" | "warning" | "blocked";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  next_action: string | null;
}

const COUNTRY_FLAG: Record<string, string> = {
  MX: "international_mexico_enabled",
  CO: "international_colombia_enabled",
  CL: "international_chile_enabled",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAdmin(req, { requireAal2: true });
  if (!auth.ok) return auth.response;
  const db = auth.supabaseAdmin;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const country = String(body.country ?? "CO").toUpperCase();
    const environment = body.environment === "sandbox" ? "sandbox" : "live";

    const [
      { data: flagRows },
      { data: settings },
      { data: policies },
      { data: platformConfigs },
      { data: accounts },
      { data: mappings },
      { data: portalUsers },
      { data: providerEvents },
      { data: outbox },
    ] = await Promise.all([
      db.from("app_feature_flags").select("key, enabled"),
      db.from("international_country_settings").select("*"),
      db
        .from("international_policies")
        .select("id, country, language, is_active, published_at, version")
        .eq("is_active", true),
      db
        .from("provider_platform_configs")
        .select("provider, environment, is_complete, missing_fields, last_verified_at, webhook_url, credential_masks, status"),
      db
        .from("provider_accounts")
        .select("id, surgeon_id, provider, environment, status, is_active, live_mode, last_verified_at, country, surgeons(name)"),
      db.from("distributor_surgeons").select("id, distributor_id, surgeon_id"),
      db.from("portal_memberships").select("id, org_type, role, is_active"),
      db
        .from("processed_provider_events")
        .select("provider, processing_status, received_at")
        .in("processing_status", ["failed", "dead", "retry"])
        .gte("received_at", new Date(Date.now() - 7 * 864e5).toISOString()),
      db.from("intl_zoho_outbox").select("id, status").in("status", ["failed", "dead"]),
    ]);

    const flags: Record<string, boolean> = {};
    for (const r of flagRows ?? []) flags[r.key as string] = !!r.enabled;

    const countrySetting = (settings ?? []).find((s) => s.country === country) ?? null;
    const checks: ReadinessCheck[] = [];

    const add = (
      id: string,
      label: string,
      ok: boolean,
      detailOk: string,
      detailBad: string,
      nextAction: string,
      warnOnly = false,
    ) =>
      checks.push({
        id,
        label,
        status: ok ? "green" : warnOnly ? "warning" : "blocked",
        detail: ok ? detailOk : detailBad,
        next_action: ok ? null : nextAction,
      });

    add(
      "master_flag",
      "International master runtime flag",
      !!flags.international_module_enabled,
      "Enabled",
      "Disabled",
      "Turn on 'International module' in Platform → Feature flags.",
    );

    const countryFlagKey = COUNTRY_FLAG[country];
    add(
      "country_flag",
      `${country} runtime flag`,
      !!flags[countryFlagKey],
      "Enabled",
      "Disabled",
      `Turn on the ${country} flag in Platform → Feature flags.`,
    );

    add(
      "country_settings",
      `${country} country settings enabled`,
      !!countrySetting?.is_enabled,
      `Enabled — ${countrySetting?.default_currency ?? "?"}, providers: ${
        (countrySetting?.allowed_providers as string[] | null)?.join(", ") ?? "none"
      }`,
      countrySetting
        ? "Country settings row exists but is_enabled is false — this silently blocks every consultation."
        : "No country settings row exists.",
      "Enable the country in International Setup → Launch readiness.",
    );

    const activePolicy = (policies ?? []).find(
      (p) => p.country === country && String(p.language ?? "").startsWith("es"),
    );
    add(
      "policy",
      `Active Spanish policy for ${country}`,
      !!activePolicy,
      `Version ${activePolicy?.version ?? ""}`,
      "No active Spanish-language policy is published.",
      "Publish a policy in International Setup → Terms.",
    );

    const mpConfig = (platformConfigs ?? []).find(
      (c) => c.provider === "mercado_pago" && c.environment === environment,
    );
    add(
      "mp_platform",
      `Mercado Pago ${environment} platform config`,
      !!mpConfig?.is_complete,
      `Complete${mpConfig?.last_verified_at ? ` — verified ${mpConfig.last_verified_at}` : ""}`,
      mpConfig
        ? `Incomplete — missing: ${(mpConfig.missing_fields as string[] | null)?.join(", ") || "unknown"}`
        : `No ${environment} configuration saved.`,
      "Save the platform credentials in International Setup → Payment accounts.",
    );

    const mpMasks = (mpConfig?.credential_masks ?? {}) as Record<string, { present?: boolean }>;
    add(
      "mp_webhook_secret",
      `Mercado Pago ${environment} webhook secret`,
      !!mpMasks.webhook_secret?.present,
      "Configured",
      "Not configured — live webhooks cannot be verified.",
      "Add the webhook secret from the Mercado Pago application to the platform config.",
    );

    const liveMpAccounts = (accounts ?? []).filter(
      (a) =>
        a.provider === "mercado_pago" &&
        a.environment === environment &&
        a.status === "connected" &&
        a.is_active,
    );
    add(
      "mp_seller",
      `Connected ${environment} Mercado Pago surgeon account`,
      liveMpAccounts.length > 0,
      `${liveMpAccounts.length} connected: ${
        liveMpAccounts.map((a) => (a.surgeons as { name?: string } | null)?.name ?? a.surgeon_id).join(", ")
      }`,
      "No surgeon has a connected, verified account in this environment.",
      "Connect a surgeon in International Setup → Payment accounts, then run 'Test connection'.",
    );

    add(
      "distributor_mapping",
      "Distributor mapped to at least one surgeon",
      (mappings ?? []).length > 0,
      `${(mappings ?? []).length} mapping(s)`,
      "No distributor is mapped to any surgeon.",
      "Assign surgeons in International Setup → Distributors.",
      true,
    );

    const activeMemberships = (portalUsers ?? []).filter((m) => m.is_active);
    add(
      "portal_roles",
      "Portal users available",
      activeMemberships.length > 0,
      `${activeMemberships.length} active membership(s)`,
      "No active portal memberships exist.",
      "Invite portal users, or create demo users in the Portal Test Center.",
      true,
    );

    add(
      "provider_events",
      "No stuck provider webhook events (7 days)",
      (providerEvents ?? []).length === 0,
      "Clean",
      `${(providerEvents ?? []).length} failed/dead provider event(s).`,
      "Review processed_provider_events and reconcile the affected payments.",
    );

    add(
      "zoho_outbox",
      "No failed international Zoho outbox items",
      (outbox ?? []).length === 0,
      "Clean",
      `${(outbox ?? []).length} failed/dead outbox item(s).`,
      "Inspect intl_zoho_outbox and retry the failed operations.",
      true,
    );

    // Provider readiness matrix (sandbox vs live), non-secret only.
    const providerMatrix = ["mercado_pago", "paypal", "stripe_connect"].map((provider) => ({
      provider,
      environments: ["sandbox", "live"].map((env) => {
        const cfg = (platformConfigs ?? []).find(
          (c) => c.provider === provider && c.environment === env,
        );
        const connected = (accounts ?? []).filter(
          (a) => a.provider === provider && a.environment === env && a.status === "connected",
        );
        return {
          environment: env,
          exists: !!cfg,
          is_complete: !!cfg?.is_complete,
          missing_fields: (cfg?.missing_fields as string[] | null) ?? [],
          last_verified_at: cfg?.last_verified_at ?? null,
          webhook_url: cfg?.webhook_url ?? null,
          connected_accounts: connected.length,
          active_accounts: connected.filter((a) => a.is_active).length,
        };
      }),
    }));

    return json({
      country,
      environment,
      flags,
      country_settings: settings ?? [],
      checks,
      provider_matrix: providerMatrix,
      mercado_pago_base_webhook_url:
        `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/intl-payment-webhook?provider=mercado_pago`,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
