import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Constants } from "@/integrations/supabase/types";
import { resolvePortalRoute, type PortalRouteInput } from "@/lib/portalAccess";

const read = (p: string) => readFileSync(p, "utf8");

const base: PortalRouteInput = {
  isAuthenticated: true,
  isPortalUser: true,
  needsChoice: false,
  activeRole: "surgeon_staff",
  mfaRequired: false,
  mfaVerified: false,
  pathname: "/portal",
};

describe("portal guard ordering", () => {
  it("sends a multi-workspace user to the chooser before MFA", () => {
    expect(resolvePortalRoute({ ...base, needsChoice: true, activeRole: "surgeon_admin" })).toEqual({
      type: "choose-workspace",
    });
  });

  it("renders the chooser itself without forcing MFA first", () => {
    expect(
      resolvePortalRoute({
        ...base,
        needsChoice: true,
        activeRole: "distributor_admin",
        mfaRequired: true,
        pathname: "/portal/select-workspace",
      }),
    ).toEqual({ type: "allow" });
  });

  it("requires MFA for an admin workspace once selected", () => {
    for (const role of ["surgeon_admin", "distributor_admin"] as const) {
      expect(resolvePortalRoute({ ...base, activeRole: role })).toEqual({ type: "mfa" });
    }
  });

  it("does not force MFA for staff or analyst workspaces", () => {
    for (const role of [
      "surgeon_staff",
      "surgeon_analyst",
      "distributor_staff",
      "distributor_analyst",
    ] as const) {
      expect(resolvePortalRoute({ ...base, activeRole: role })).toEqual({ type: "allow" });
    }
  });

  it("honours account-level mfa_required only after workspace selection", () => {
    expect(resolvePortalRoute({ ...base, mfaRequired: true })).toEqual({ type: "mfa" });
    expect(
      resolvePortalRoute({ ...base, mfaRequired: true, needsChoice: true }),
    ).toEqual({ type: "choose-workspace" });
  });

  it("lets a verified admin through", () => {
    expect(
      resolvePortalRoute({ ...base, activeRole: "surgeon_admin", mfaVerified: true }),
    ).toEqual({ type: "allow" });
  });
});

describe("launch readiness country mutations", () => {
  const SRC = read("supabase/functions/intl-launch-readiness/index.ts");

  it("requires super admin and AAL2 for every mutation", () => {
    expect(SRC).toContain("requireAal2: true");
    expect(SRC).toContain('!== "super_admin"');
    expect(SRC).toContain('if (action !== "status")');
  });

  it("validates the provider allowlist and supported countries", () => {
    expect(SRC).toContain(
      'const VALID_PROVIDERS = ["test", "mercado_pago", "paypal", "stripe_connect"]',
    );
    expect(SRC).toContain("Unsupported provider(s)");
    expect(SRC).toContain("VALID_COUNTRIES.includes(country)");
    expect(SRC).toContain("set_country_enabled");
    expect(SRC).toContain("set_allowed_providers");
  });
});

describe("launch readiness UI", () => {
  const SRC = read("src/components/admin/intl/setup/LaunchReadinessSection.tsx");

  it("includes the VITE_ENABLE_INTL build gate in the blocked count", () => {
    expect(SRC).toContain("INTL_BUILD_ENABLED");
    expect(SRC).toContain("intl_build_flag");
    expect(SRC).toContain("const checks: ReadinessCheck[] = [buildGateCheck()");
  });

  it("mutates country settings through the edge function only", () => {
    expect(SRC).not.toContain('from("international_country_settings")');
    expect(SRC).toContain('action: "set_country_enabled"');
    expect(SRC).toContain('action: "set_allowed_providers"');
  });
});

describe("Portal Test Center usability", () => {
  const SRC = read("src/components/admin/intl/setup/PortalTestCenter.tsx");

  it("offers portal login and copy-email controls", () => {
    expect(SRC).toContain("Open portal login");
    expect(SRC).toContain("/portal/login");
    expect(SRC).toContain("navigator.clipboard.writeText");
  });

  it("documents every demo role and the real payment smoke test", () => {
    for (const email of [
      "qa.multi.admin@himplant.com",
      "qa.surgeon.staff@himplant.com",
      "qa.surgeon.analyst@himplant.com",
      "qa.distributor.staff@himplant.com",
      "qa.distributor.analyst@himplant.com",
    ]) {
      expect(SRC).toContain(email);
    }
    expect(SRC).toContain("QA Unmapped Surgeon Colombia");
    expect(SRC).toContain("Real Mercado Pago payment smoke test");
    expect(SRC).toContain("REAL_PAYMENT_SMOKE_TEST");
  });
});

describe("QA fixture values are legal for the live schema", () => {
  const SRC = read("supabase/functions/intl-qa-fixtures/index.ts");
  const block = SRC.split("const CONSULTATION_FIXTURES = [")[1].split("] as const;")[0];
  const pick = (key: string) =>
    [...block.matchAll(new RegExp(`${key}: "([a-z_]+)"`, "g"))].map((m) => m[1]);

  it("uses only real payment / consultation / surgery statuses", () => {
    for (const v of pick("payment")) expect(Constants.public.Enums.intl_payment_status).toContain(v);
    for (const v of pick("consultation")) {
      expect(Constants.public.Enums.intl_consultation_status).toContain(v);
    }
    for (const v of pick("surgery")) expect(Constants.public.Enums.intl_surgery_status).toContain(v);
  });

  it("uses legal provider, country and connection-method values", () => {
    expect(Constants.public.Enums.payment_provider).toContain("test");
    expect(Constants.public.Enums.intl_country).toContain("CO");
    expect(Constants.public.Enums.provider_connection_method).toContain("admin_managed");
    expect(Constants.public.Enums.provider_account_status).toContain("connected");
    expect(SRC).toContain('connection_method: "admin_managed"');
  });
});

describe("international RLS migration", () => {
  const SQL = read(
    "supabase/migrations/20260813070433_9ff24776-e6e7-4fb6-8fdd-24bb3b779426.sql",
  );

  it("removes direct portal SELECT access to sensitive international data", () => {
    for (const table of [
      "public.consultations",
      "public.consultation_patients",
      "public.consultation_events",
      "public.consultation_policy_snapshots",
      "public.consultation_tasks",
    ]) {
      expect(SQL).toContain(`ON ${table}`);
    }
    expect(SQL).toContain("DROP POLICY IF EXISTS");
  });
});
