import { describe, it, expect } from "vitest";
import { toRoleCode, toAccessLevel, friendlyRoleLabel } from "@/lib/portalAccessLevels";
import {
  computeSurgeonReadiness,
  paymentState,
  portalAccessState,
  sortDistributorsForCountry,
  summarise,
  type NetworkPayload,
} from "@/lib/intlNetwork";

const surgeon = (over: Partial<NetworkPayload["surgeons"][number]> = {}) => ({
  id: "s1",
  name: "Dr. Uno",
  email: "uno@example.com",
  country: "MX",
  city: "CDMX",
  is_active: true,
  consultation_fee_minor: 100000,
  currency: "MXN",
  active_provider: null,
  ...over,
});

describe("friendly access levels map to existing role codes", () => {
  it("maps both organisation kinds", () => {
    expect(toRoleCode("surgeon", "admin")).toBe("surgeon_admin");
    expect(toRoleCode("surgeon", "staff")).toBe("surgeon_staff");
    expect(toRoleCode("surgeon", "view_only")).toBe("surgeon_analyst");
    expect(toRoleCode("distributor", "admin")).toBe("distributor_admin");
    expect(toRoleCode("distributor", "staff")).toBe("distributor_staff");
    expect(toRoleCode("distributor", "view_only")).toBe("distributor_analyst");
  });

  it("round-trips back to a friendly label", () => {
    expect(toAccessLevel("distributor_analyst")).toBe("view_only");
    expect(friendlyRoleLabel("surgeon_admin")).toBe("Surgeon Admin");
    expect(friendlyRoleLabel("distributor_staff")).toBe("Distributor Staff");
  });
});

describe("surgeon readiness gives one next action", () => {
  const base = {
    surgeon: surgeon(),
    distributorId: "d1",
    countrySetting: { country: "MX", is_enabled: true, allowed_providers: ["mercado_pago"] },
    hasPolicy: true,
    payment: { connected: true, provider: "mercado_pago", label: "Connected" },
    access: "active" as const,
  };

  it("is ready only when everything is in place", () => {
    expect(computeSurgeonReadiness(base).label).toBe("Ready");
  });

  it("flags a missing CRM country first", () => {
    const r = computeSurgeonReadiness({ ...base, surgeon: surgeon({ country: null }) });
    expect(r.label).toBe("Needs CRM country");
    expect(r.tone).toBe("blocked");
  });

  it("lets onboarding continue while a country is still disabled", () => {
    const closed = { country: "MX", is_enabled: false, allowed_providers: [] };
    expect(
      computeSurgeonReadiness({ ...base, countrySetting: closed, distributorId: null }).label,
    ).toBe("Needs distributor");
    expect(computeSurgeonReadiness({ ...base, countrySetting: closed, hasPolicy: false }).label).toBe(
      "Needs terms",
    );
    expect(
      computeSurgeonReadiness({
        ...base,
        countrySetting: closed,
        payment: { connected: false, provider: null, label: "Needs setup" },
      }).label,
    ).toBe("Needs payment account");
    expect(computeSurgeonReadiness({ ...base, countrySetting: closed, access: "none" }).label).toBe(
      "Needs portal access",
    );
  });

  it("only shows country-not-live once everything else is done, and never Ready", () => {
    const r = computeSurgeonReadiness({
      ...base,
      countrySetting: { country: "MX", is_enabled: false, allowed_providers: [] },
    });
    expect(r.label).toBe("Country not live");
    expect(r.tone).not.toBe("ready");
  });

  it("still flags an unsupported CRM country ahead of everything", () => {
    const r = computeSurgeonReadiness({
      ...base,
      surgeon: surgeon({ country: "US" }),
      countrySetting: { country: "MX", is_enabled: false, allowed_providers: [] },
      distributorId: null,
    });
    expect(r.label).toBe("Needs CRM country");
  });

  it("flags a missing distributor", () => {
    expect(computeSurgeonReadiness({ ...base, distributorId: null }).label).toBe("Needs distributor");
  });

  it("flags a missing payment account", () => {
    const r = computeSurgeonReadiness({
      ...base,
      payment: { connected: false, provider: null, label: "Needs setup" },
    });
    expect(r.label).toBe("Needs payment account");
  });

  it("never exposes internal flag names", () => {
    const labels = [
      computeSurgeonReadiness(base),
      computeSurgeonReadiness({ ...base, distributorId: null }),
      computeSurgeonReadiness({ ...base, hasPolicy: false }),
    ].map((r) => `${r.label} ${r.hint}`);
    for (const l of labels) {
      expect(l).not.toMatch(/flag|_enabled|is_active|provider_accounts|RLS/i);
    }
  });
});

describe("payment state", () => {
  it("only counts a live, active, allowed provider as connected", () => {
    const acct = {
      surgeon_id: "s1",
      provider: "mercado_pago",
      status: "connected",
      is_active: true,
      live_mode: true,
      country: "MX",
    };
    expect(paymentState([acct], ["mercado_pago"]).connected).toBe(true);
    expect(paymentState([{ ...acct, live_mode: false }], ["mercado_pago"]).connected).toBe(false);
    expect(paymentState([acct], ["paypal"]).connected).toBe(false);
    expect(paymentState([], []).label).toBe("Needs setup");
  });
});

describe("portal access state", () => {
  const m = (accepted: string | null) => ({
    id: "m1",
    org_type: "surgeon" as const,
    surgeon_id: "s1",
    distributor_id: null,
    role: "surgeon_admin",
    portal_user: { id: "p1", email: "a@b.c", full_name: null, accepted_at: accepted, is_active: true, last_login_at: null },
  });

  it("distinguishes none / invited / active", () => {
    expect(portalAccessState([])).toBe("none");
    expect(portalAccessState([m(null)])).toBe("invited");
    expect(portalAccessState([m("2026-01-01")])).toBe("active");
  });
});

describe("distributor dropdown prefers the surgeon's country", () => {
  it("sorts matching countries first", () => {
    const list = [
      { id: "a", name: "Zeta", legal_name: null, countries: ["CL"], primary_contact_email: null, primary_contact_phone: null, is_active: true },
      { id: "b", name: "Alpha", legal_name: null, countries: ["MX"], primary_contact_email: null, primary_contact_phone: null, is_active: true },
    ];
    expect(sortDistributorsForCountry(list, "MX").map((d) => d.id)).toEqual(["b", "a"]);
  });
});

describe("network summary", () => {
  it("counts unassigned surgeons and live countries", () => {
    const payload: NetworkPayload = {
      admin_role: "super_admin",
      surgeons: [surgeon(), surgeon({ id: "s2" })],
      distributors: [
        { id: "d1", name: "D", legal_name: null, countries: ["MX"], primary_contact_email: null, primary_contact_phone: null, is_active: true },
      ],
      assignments: [{ surgeon_id: "s1", distributor_id: "d1" }],
      memberships: [],
      provider_accounts: [],
      country_settings: [
        { country: "MX", is_enabled: true, allowed_providers: [] },
        { country: "CO", is_enabled: false, allowed_providers: [] },
      ],
      policies: [],
    };
    const s = summarise(payload);
    expect(s.surgeons).toBe(2);
    expect(s.unassigned).toBe(1);
    expect(s.countriesLive).toBe(1);
    expect(s.paymentReady).toBe(0);
  });
});
