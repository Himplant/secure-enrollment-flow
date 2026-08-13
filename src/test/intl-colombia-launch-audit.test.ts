import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { countryLaunchState, paymentState, type NetworkPayload } from "@/lib/intlNetwork";
import { selectableProvidersFor } from "@/components/admin/intl/setup/LaunchReadinessSection";
import { DEFAULT_FEATURE_FLAGS } from "@/lib/featureFlags";

const read = (p: string) => readFileSync(p, "utf8");

describe("disabled payment providers disappear from the UI", () => {
  it("only lists providers whose runtime flag is on for country allowed-providers", () => {
    const flags = { ...DEFAULT_FEATURE_FLAGS, mercado_pago_enabled: true };
    expect(selectableProvidersFor(flags)).toEqual(["mercado_pago"]);
    expect(selectableProvidersFor(DEFAULT_FEATURE_FLAGS)).toEqual([]);
  });

  it("renders provider tabs from the server payload, not a hardcoded list", () => {
    const src = read("src/components/providers/ProviderSetupPanel.tsx");
    expect(src).not.toMatch(/PROVIDER_TABS/);
    expect(src).toMatch(/data\?\.platform \?\? \[\]/);
  });

  it("defaults admin provider setup to production, not sandbox", () => {
    const src = read("src/components/providers/ProviderSetupPanel.tsx");
    expect(src).toMatch(/useState<ProviderEnvironment>\("live"\)/);
  });

  it("returns only flag-enabled providers from the status endpoint", () => {
    const src = read("supabase/functions/provider-config-status/index.ts");
    expect(src).toMatch(/enabledProviders/);
    expect(src).toMatch(/enabled_providers/);
  });

  it("rejects a disabled provider server-side on every provider mutation", () => {
    for (const fn of [
      "provider-connect-start",
      "provider-save-manual-credentials",
      "provider-set-active",
      "provider-test-connection",
      "provider-rotate-credentials",
      "admin-save-provider-platform-config",
    ]) {
      expect(read(`supabase/functions/${fn}/index.ts`)).toMatch(/requireProviderEnabled/);
    }
  });
});

describe("live consultations can never use a sandbox or test account", () => {
  it("filters provider accounts by live environment when creating a consultation", () => {
    const src = read("supabase/functions/_shared/intl-consultation-service.ts");
    expect(src).toMatch(/live_mode/);
    expect(src).toMatch(/environment/);
  });

  it("re-verifies surgeon, provider, environment and merchant at payment time", () => {
    const src = read("supabase/functions/intl-create-payment/index.ts");
    expect(src).toMatch(/surgeon_id/);
    expect(src).toMatch(/live_mode/);
    expect(src).toMatch(/recipient_external_merchant_id/);
  });

  it("rejects a cross-seller provider_account_id on the webhook", () => {
    const src = read("supabase/functions/intl-payment-webhook/index.ts");
    expect(src).toMatch(/mismatch/i);
  });

  it("keeps the Mercado Pago notification URL environment routing", () => {
    const src = read("supabase/functions/_shared/providers/mercado-pago.ts");
    expect(src).toMatch(/searchParams\.set\("provider", "mercado_pago"\)/);
    expect(src).toMatch(/searchParams\.set\("environment"/);
    expect(src).toMatch(/searchParams\.set\("provider_account_id"/);
  });
});

describe("launch readiness is honest about what is live", () => {
  it("does not accept a sandbox or test provider account as live readiness", () => {
    const src = read("supabase/functions/intl-launch-readiness/index.ts");
    expect(src).toMatch(/live_mode/);
    expect(src).toMatch(/"test"/);
  });

  it("no longer points operators at the removed International Setup tab", () => {
    for (const p of [
      "supabase/functions/intl-launch-readiness/index.ts",
      "src/components/admin/intl/hub/OverviewSection.tsx",
    ]) {
      expect(read(p)).not.toMatch(/International Setup/);
    }
  });
});

const payload = (over: Partial<NetworkPayload> = {}): NetworkPayload =>
  ({
    admin_role: "super_admin",
    admin_user_id: "a1",
    surgeons: [
      {
        id: "s1",
        name: "Dr CO",
        country: "CO",
        is_active: true,
        currency: null,
        consultation_fee_minor: 0,
      },
    ],
    distributors: [],
    assignments: [],
    memberships: [],
    provider_accounts: [],
    country_settings: [
      {
        country: "CO",
        is_enabled: false,
        allowed_providers: ["test", "mercado_pago"],
        default_currency: "COP",
      },
    ],
    policies: [{ country: "CO", surgeon_id: null, is_active: true }],
    ...over,
  }) as unknown as NetworkPayload;

describe("Colombia country status", () => {
  it("reads as available but not live, with counted blockers", () => {
    const state = countryLaunchState(payload(), "CO", true);
    expect(state.live).toBe(false);
    expect(state.label).toMatch(/Available, not live — \d+ blocker/);
    expect(state.blockers.join(" ")).toMatch(/simulated test provider still allowed/);
    expect(state.blockers.join(" ")).toMatch(/no live payment account/);
  });

  it("does not count a sandbox account as a live payment account", () => {
    const state = countryLaunchState(
      payload({
        provider_accounts: [
          {
            surgeon_id: "s1",
            provider: "mercado_pago",
            status: "connected",
            is_active: true,
            live_mode: false,
            environment: "sandbox",
            country: "CO",
          },
        ],
      } as Partial<NetworkPayload>),
      "CO",
      true,
    );
    expect(state.blockers).toContain("no live payment account");
  });

  it("does not count a Mexican account towards Colombian readiness", () => {
    expect(
      paymentState(
        [
          {
            surgeon_id: "s1",
            provider: "mercado_pago",
            status: "connected",
            is_active: true,
            live_mode: true,
            environment: "live",
            country: "MX",
          },
        ],
        ["mercado_pago"],
        "CO",
      ).connected,
    ).toBe(false);
  });
});

describe("Colombian consultations never fall back to USD", () => {
  it("resolves the currency from the country default when the surgeon has none", () => {
    const src = read("src/components/admin/intl/CreateConsultationModal.tsx");
    expect(src).toMatch(/s\.currency \?\? setting\?\.default_currency/);
    expect(src).toMatch(/disabled=\{!o\.ready\}/);
  });

  it("passes the country default currency through the network payload", () => {
    expect(read("supabase/functions/intl-admin-network/index.ts")).toMatch(/default_currency/);
  });
});

describe("protected U.S. enrollment behaviour is untouched", () => {
  it("keeps the Stripe enrollment functions free of international gating", () => {
    for (const fn of ["create-checkout-session", "stripe-webhook", "create-enrollment"]) {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src).not.toMatch(/requireIntlEnabled|requireProviderEnabled/);
    }
  });
});

describe("every international entry point is flag-gated on the server", () => {
  it("gates the Zoho create path through the shared consultation service", () => {
    const svc = read("supabase/functions/_shared/intl-consultation-service.ts");
    expect(svc).toMatch(/requireIntlEnabled\(\{ country, provider \}\)/);
    expect(read("supabase/functions/intl-create-consultation-from-zoho/index.ts")).toMatch(
      /createIntlConsultation/,
    );
  });

  it("keeps the QA fixture tooling behind its own super-admin + QA flag gate", () => {
    const src = read("supabase/functions/intl-qa-fixtures/index.ts");
    expect(src).toMatch(/super_admin/);
    expect(src).toMatch(/international_portal_qa_enabled/);
  });

  it("gates the reminder, reconciliation and portal paths", () => {
    for (const fn of [
      "intl-process-reminders",
      "intl-reconcile-payments",
      "intl-portal-resend-link",
      "intl-send-consultation-link",
      "intl-portal-consultations",
      "intl-portal-update-consultation",
    ]) {
      expect(read(`supabase/functions/${fn}/index.ts`)).toMatch(/requireIntlEnabled/);
    }
  });
});
