/**
 * International module feature flags.
 *
 * Two layers, both must be true for a feature to be live:
 *  1. Build-time  — VITE_ENABLE_INTL keeps the international bundle out of
 *                   production entirely while the module is being built.
 *  2. Runtime     — rows in `app_feature_flags`, all seeded to false.
 *
 * The US enrollment flow never reads any of this. With every flag off the
 * application behaves exactly as it does today.
 */

export const FEATURE_FLAG_KEYS = [
  "international_module_enabled",
  "international_mexico_enabled",
  "international_colombia_enabled",
  "international_chile_enabled",
  "mercado_pago_enabled",
  "paypal_enabled",
  "surgeon_portal_enabled",
  "distributor_portal_enabled",
  "test_provider_enabled",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = FEATURE_FLAG_KEYS.reduce(
  (acc, key) => ({ ...acc, [key]: false }),
  {} as FeatureFlags,
);

/** Build-time master gate. Absent env var means "off". */
export const INTL_BUILD_ENABLED =
  String(import.meta.env.VITE_ENABLE_INTL ?? "").toLowerCase() === "true";

/** Country code -> the flag that must be on for that country to operate. */
export const COUNTRY_FLAG: Record<string, FeatureFlagKey> = {
  MX: "international_mexico_enabled",
  CO: "international_colombia_enabled",
  CL: "international_chile_enabled",
};

/** Payment provider -> the flag that must be on for that provider to be offered. */
export const PROVIDER_FLAG: Record<string, FeatureFlagKey> = {
  mercado_pago: "mercado_pago_enabled",
  paypal: "paypal_enabled",
  test: "test_provider_enabled",
};

/** The module master switch gates everything else. */
export function isIntlEnabled(flags: FeatureFlags): boolean {
  return INTL_BUILD_ENABLED && flags.international_module_enabled;
}

export function isCountryEnabled(flags: FeatureFlags, country: string): boolean {
  const key = COUNTRY_FLAG[country];
  return isIntlEnabled(flags) && !!key && flags[key];
}

export function isProviderEnabled(flags: FeatureFlags, provider: string): boolean {
  const key = PROVIDER_FLAG[provider];
  return isIntlEnabled(flags) && !!key && flags[key];
}

export function isDistributorPortalEnabled(flags: FeatureFlags): boolean {
  return isIntlEnabled(flags) && flags.distributor_portal_enabled;
}

export function isClinicPortalEnabled(flags: FeatureFlags): boolean {
  return isIntlEnabled(flags) && flags.surgeon_portal_enabled;
}
