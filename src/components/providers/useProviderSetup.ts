import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";

export type ProviderEnvironment = "sandbox" | "live";

export interface PlatformFieldSpec {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
}

export interface PlatformConfig {
  id: string;
  provider: string;
  environment: string;
  country: string | null;
  status: string;
  is_complete: boolean;
  missing_fields: string[] | null;
  callback_url: string | null;
  webhook_url: string | null;
  return_url: string | null;
  credential_masks: Record<string, { present: boolean; mask: string | null }> | null;
  capabilities: Record<string, unknown> | null;
  last_verified_at: string | null;
  last_test_error: string | null;
  updated_at: string;
}

export interface PlatformEntry {
  provider: string;
  environment: ProviderEnvironment;
  implemented: boolean;
  /** Portal-safe signal: Himplant has completed platform setup for this provider. */
  platformReady?: boolean;
  fields: PlatformFieldSpec[];
  callbackUrl: string;
  webhookUrl: string;
  returnUrl: string;
  config: PlatformConfig | null;
}

export interface ProviderAccount {
  id: string;
  surgeon_id: string;
  provider: string;
  country: string;
  currency: string;
  environment: string;
  connection_method: string;
  external_merchant_id: string | null;
  status: string;
  is_active: boolean;
  live_mode: boolean | null;
  scopes: string | null;
  token_expires_at: string | null;
  onboarding_status: string | null;
  onboarding_url: string | null;
  connection_error: string | null;
  last_verified_at: string | null;
  last_tested_at: string | null;
  webhook_status: string | null;
  credential_masks: Record<string, { present: boolean; mask: string | null }> | null;
  updated_at: string;
  surgeons: { name: string; country: string | null } | null;
}

export interface ProviderStatusResponse {
  actor: { kind: string; canManagePlatform: boolean };
  environment: ProviderEnvironment;
  /** Providers whose runtime feature flag is on. Disabled ones are omitted. */
  enabled_providers: string[];
  platform: PlatformEntry[];
  /** Surgeons the caller may connect an account for (server-derived scope). */
  surgeons: { id: string; name: string; country: string | null }[];
  accounts: ProviderAccount[];
}


/** Surfaces the real edge-function error body instead of "non-2xx status code". */
export async function callProviderFn<T = Record<string, unknown>>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    if (error instanceof FunctionsHttpError) {
      const text = await error.context.text();
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        message = text || message;
      }
    }
    throw new Error(message);
  }
  return data as T;
}

export function useProviderSetup(environment: ProviderEnvironment) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["provider-setup", environment],
    queryFn: () => callProviderFn<ProviderStatusResponse>("provider-config-status", { environment }),
    staleTime: 0,
  });
  return {
    ...query,
    refresh: () => qc.invalidateQueries({ queryKey: ["provider-setup"] }),
  };
}
