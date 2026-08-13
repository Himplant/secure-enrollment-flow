/**
 * Pure readiness logic for the International > Network screen.
 *
 * Turns the raw network payload into one plain-English "next action" per
 * surgeon so a non-technical operator never has to read a flag name.
 */

export type ReadinessTone = "ready" | "warning" | "blocked";

export interface ReadinessResult {
  tone: ReadinessTone;
  label: string;
  /** Short plain-English hint for the row tooltip. */
  hint: string;
}

export interface NetworkSurgeon {
  id: string;
  name: string;
  email: string | null;
  country: string | null;
  city: string | null;
  is_active: boolean;
  consultation_fee_minor: number | null;
  currency: string | null;
  active_provider: string | null;
}

export interface NetworkDistributor {
  id: string;
  name: string;
  legal_name: string | null;
  countries: string[];
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  is_active: boolean;
}

export interface NetworkAssignment {
  surgeon_id: string;
  distributor_id: string;
}

export interface NetworkMembership {
  id: string;
  org_type: "surgeon" | "distributor";
  surgeon_id: string | null;
  distributor_id: string | null;
  role: string;
  portal_user: {
    id: string;
    email: string;
    full_name: string | null;
    accepted_at: string | null;
    is_active: boolean;
    last_login_at: string | null;
  } | null;
}

export interface NetworkProviderAccount {
  surgeon_id: string;
  provider: string;
  status: string;
  is_active: boolean;
  live_mode: boolean;
  environment?: string | null;
  country: string | null;
}

export interface NetworkCountrySetting {
  country: string;
  is_enabled: boolean;
  allowed_providers: string[];
}

export interface NetworkPolicy {
  country: string;
  surgeon_id: string | null;
  is_active: boolean;
}

export interface NetworkPayload {
  admin_role: string | null;
  surgeons: NetworkSurgeon[];
  distributors: NetworkDistributor[];
  assignments: NetworkAssignment[];
  memberships: NetworkMembership[];
  provider_accounts: NetworkProviderAccount[];
  country_settings: NetworkCountrySetting[];
  policies: NetworkPolicy[];
}

export const SUPPORTED_COUNTRIES = ["MX", "CO", "CL"] as const;

export function isSupportedCountry(country: string | null | undefined): boolean {
  return !!country && (SUPPORTED_COUNTRIES as readonly string[]).includes(country);
}

export type PortalAccessState = "none" | "invited" | "active";

export function portalAccessState(memberships: NetworkMembership[]): PortalAccessState {
  if (memberships.length === 0) return "none";
  return memberships.some((m) => m.portal_user?.accepted_at) ? "active" : "invited";
}

export interface PaymentState {
  connected: boolean;
  provider: string | null;
  label: string;
}

/**
 * "Connected" means a REAL, live merchant account that this surgeon's country
 * is allowed to use. A sandbox/test account or an account registered in
 * another country never counts — otherwise an operator would believe a
 * surgeon can be paid when only QA credentials exist.
 */
export function paymentState(
  accounts: NetworkProviderAccount[],
  allowedProviders: string[],
  country?: string | null,
): PaymentState {
  const live = accounts.find(
    (a) =>
      a.is_active &&
      a.live_mode === true &&
      a.status === "connected" &&
      a.provider !== "test" &&
      (a.environment ?? "live") === "live" &&
      (!country || !a.country || a.country.toUpperCase() === country.toUpperCase()) &&
      (allowedProviders.length === 0 || allowedProviders.includes(a.provider)),
  );
  if (live) return { connected: true, provider: live.provider, label: "Connected" };
  const any = accounts.find((a) => a.status === "connected");
  if (any) return { connected: false, provider: any.provider, label: "Test account only" };
  return { connected: false, provider: null, label: "Needs payment account" };
}

export interface ReadinessInput {
  surgeon: NetworkSurgeon;
  distributorId: string | null;
  countrySetting: NetworkCountrySetting | null;
  hasPolicy: boolean;
  payment: PaymentState;
  access: PortalAccessState;
}

/**
 * One status per surgeon. The FIRST unmet requirement wins so the operator
 * always sees a single next action instead of a wall of red.
 */
export function computeSurgeonReadiness(i: ReadinessInput): ReadinessResult {
  if (!isSupportedCountry(i.surgeon.country)) {
    return {
      tone: "blocked",
      label: "Needs CRM country",
      hint: "Add a supported country to this surgeon in Zoho CRM, then sync again.",
    };
  }
  if (!i.distributorId) {
    return {
      tone: "warning",
      label: "Needs distributor",
      hint: "Choose the distributor that oversees this surgeon.",
    };
  }
  if (!i.hasPolicy) {
    return {
      tone: "warning",
      label: "Needs terms",
      hint: "Publish consultation terms for this country under Advanced setup.",
    };
  }
  if (!i.payment.connected) {
    return {
      tone: "warning",
      label: "Needs payment account",
      hint: "The surgeon connects their own payment account from their portal.",
    };
  }
  if (i.access === "none") {
    return {
      tone: "warning",
      label: "Needs portal access",
      hint: "Invite someone from this practice to the portal.",
    };
  }
  // Country gating comes last: the operator can finish onboarding while a
  // country stays safely closed, but "Ready" still requires it to be open.
  if (!i.countrySetting || !i.countrySetting.is_enabled) {
    return {
      tone: "warning",
      label: "Country not live",
      hint: "Setup is complete — this country is not open for consultations yet.",
    };
  }
  return { tone: "ready", label: "Ready", hint: "This surgeon can take live consultations." };
}

/** Distributors that serve the surgeon's country come first in the dropdown. */
export function sortDistributorsForCountry(
  distributors: NetworkDistributor[],
  country: string | null,
): NetworkDistributor[] {
  return [...distributors].sort((a, b) => {
    const am = country && (a.countries ?? []).includes(country) ? 0 : 1;
    const bm = country && (b.countries ?? []).includes(country) ? 0 : 1;
    return am !== bm ? am - bm : a.name.localeCompare(b.name);
  });
}

export interface NetworkSummary {
  surgeons: number;
  unassigned: number;
  distributors: number;
  portalUsers: number;
  paymentReady: number;
  countriesLive: number;
}

export function summarise(payload: NetworkPayload): NetworkSummary {
  const assignedIds = new Set(payload.assignments.map((a) => a.surgeon_id));
  const allowedByCountry = Object.fromEntries(
    payload.country_settings.map((c) => [c.country, c.allowed_providers ?? []]),
  );
  const paymentReady = payload.surgeons.filter((s) =>
    paymentState(
      payload.provider_accounts.filter((a) => a.surgeon_id === s.id),
      allowedByCountry[s.country ?? ""] ?? [],
      s.country,
    ).connected,
  ).length;

  return {
    surgeons: payload.surgeons.length,
    unassigned: payload.surgeons.filter((s) => !assignedIds.has(s.id)).length,
    distributors: payload.distributors.filter((d) => d.is_active).length,
    portalUsers: new Set(
      payload.memberships.map((m) => m.portal_user?.id).filter(Boolean) as string[],
    ).size,
    paymentReady,
    countriesLive: payload.country_settings.filter((c) => c.is_enabled).length,
  };
}


export interface CountryLaunchState {
  country: string;
  /** The runtime feature flag makes the country available to be launched. */
  available: boolean;
  /** The country settings switch is the real "open for patients" control. */
  live: boolean;
  blockers: string[];
  label: string;
}

/**
 * Plain-English status for one country, combining the availability flag with
 * the country launch switch so an operator never has to reason about two
 * separate toggles.
 */
export function countryLaunchState(
  payload: NetworkPayload,
  country: string,
  available: boolean,
): CountryLaunchState {
  const setting = payload.country_settings.find((c) => c.country === country) ?? null;
  const surgeons = payload.surgeons.filter((s) => s.country === country);
  const assigned = new Set(payload.assignments.map((a) => a.surgeon_id));
  const blockers: string[] = [];

  if (!setting) blockers.push("no country settings");
  if (!payload.policies.some((p) => p.country === country && p.is_active)) {
    blockers.push("no active terms");
  }
  if (!surgeons.length) blockers.push("no surgeons synced");
  if (surgeons.length && !surgeons.some((s) => assigned.has(s.id))) {
    blockers.push("no surgeon has a distributor");
  }
  const paymentReady = surgeons.filter(
    (s) =>
      paymentState(
        payload.provider_accounts.filter((a) => a.surgeon_id === s.id),
        setting?.allowed_providers ?? [],
        country,
      ).connected,
  ).length;
  if (!paymentReady) blockers.push("no live payment account");
  if (!surgeons.some((s) => payload.memberships.some((m) => m.surgeon_id === s.id))) {
    blockers.push("no portal access");
  }
  if ((setting?.allowed_providers ?? []).includes("test")) {
    blockers.push("simulated test provider still allowed");
  }

  const live = !!setting?.is_enabled;
  const label = !available
    ? "Not available"
    : live
      ? blockers.length
        ? `Live — ${blockers.length} warning${blockers.length === 1 ? "" : "s"}`
        : "Live"
      : `Available, not live — ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`;

  return { country, available, live, blockers, label };
}
