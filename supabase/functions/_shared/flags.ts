// Server-side feature flag checks for the international module.
//
// A disabled flag must fail on the server, not only hide UI. Every `intl-*`
// and `portal-*` edge function calls requireIntlEnabled() before doing work.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

export type FeatureFlagKey =
  | "international_module_enabled"
  | "international_mexico_enabled"
  | "international_colombia_enabled"
  | "international_chile_enabled"
  | "mercado_pago_enabled"
  | "paypal_enabled"
  | "stripe_connect_enabled"
  | "surgeon_portal_enabled"
  | "distributor_portal_enabled"
  | "test_provider_enabled"
  | "international_portal_qa_enabled";

const COUNTRY_FLAG: Record<string, FeatureFlagKey> = {
  MX: "international_mexico_enabled",
  CO: "international_colombia_enabled",
  CL: "international_chile_enabled",
};

const PROVIDER_FLAG: Record<string, FeatureFlagKey> = {
  mercado_pago: "mercado_pago_enabled",
  paypal: "paypal_enabled",
  stripe_connect: "stripe_connect_enabled",
  test: "test_provider_enabled",
};


function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function getFlags(): Promise<Record<string, boolean>> {
  const { data } = await serviceClient().from("app_feature_flags").select("key, enabled");
  const flags: Record<string, boolean> = {};
  for (const row of data ?? []) flags[row.key as string] = !!row.enabled;
  return flags;
}

export interface FlagCheck {
  /** Country code whose flag must also be enabled. */
  country?: string;
  /** Provider whose flag must also be enabled. */
  provider?: string;
  /** Extra flags that must all be enabled. */
  require?: FeatureFlagKey[];
}

/**
 * Returns null when everything required is enabled, or a 503 Response to
 * return directly when the module or a sub-feature is switched off.
 */
export async function requireIntlEnabled(check: FlagCheck = {}): Promise<Response | null> {
  const flags = await getFlags();
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  const deny = (message: string) =>
    new Response(JSON.stringify({ error: message, code: "feature_disabled" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (!flags.international_module_enabled) {
    return deny("International consultations are not enabled");
  }

  if (check.country) {
    const key = COUNTRY_FLAG[check.country];
    if (!key || !flags[key]) return deny(`Consultations are not enabled for ${check.country}`);
  }

  if (check.provider) {
    const key = PROVIDER_FLAG[check.provider];
    if (!key || !flags[key]) return deny(`Payment provider ${check.provider} is not enabled`);
  }

  for (const key of check.require ?? []) {
    if (!flags[key]) return deny(`Feature ${key} is not enabled`);
  }

  return null;
}
