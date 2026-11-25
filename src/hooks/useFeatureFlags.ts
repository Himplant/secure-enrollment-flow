import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  type FeatureFlagKey,
  type FeatureFlags,
} from "@/lib/featureFlags";

/**
 * Reads runtime feature flags. Only admins and active portal users may read
 * them (enforced by database access rules); everyone else gets the all-off
 * defaults. Enforcement also happens server-side inside every `intl-*` edge
 * function, so hiding UI is never the only control.
 */
export function useFeatureFlags() {
  const query = useQuery({
    queryKey: ["app-feature-flags"],
    staleTime: 60_000,
    queryFn: async (): Promise<FeatureFlags> => {
      const { data, error } = await supabase
        .from("app_feature_flags")
        .select("key, enabled");

      if (error) throw error;

      const flags = { ...DEFAULT_FEATURE_FLAGS };
      for (const row of data ?? []) {
        if ((FEATURE_FLAG_KEYS as readonly string[]).includes(row.key)) {
          flags[row.key as FeatureFlagKey] = !!row.enabled;
        }
      }
      return flags;
    },
  });

  return {
    flags: query.data ?? DEFAULT_FEATURE_FLAGS,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
