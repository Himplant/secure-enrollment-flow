import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, Flag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FEATURE_FLAG_KEYS, INTL_BUILD_ENABLED } from "@/lib/featureFlags";

const LABELS: Record<string, string> = {
  international_module_enabled: "International module (master switch)",
  international_mexico_enabled: "Mexico",
  international_colombia_enabled: "Colombia",
  international_chile_enabled: "Chile",
  mercado_pago_enabled: "Mercado Pago provider",
  paypal_enabled: "PayPal provider",
  stripe_connect_enabled: "Stripe Connect provider (international only)",
  surgeon_portal_enabled: "Clinic / surgeon portal",
  distributor_portal_enabled: "Distributor portal",
  test_provider_enabled: "Simulated test provider",
  international_portal_qa_enabled: "Portal Test Center (QA tooling)",
};


/**
 * Super-admin only. Every flag is enforced again server-side inside the
 * `intl-*` edge functions, so turning one off here genuinely disables the
 * feature rather than just hiding UI.
 */
export function FeatureFlagsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-feature-flags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_feature_flags")
        .select("key, enabled, description");
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggle = async (key: string, enabled: boolean) => {
    const { error } = await supabase.from("app_feature_flags").update({ enabled }).eq("key", key);
    if (error) {
      toast({ title: "Could not update flag", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${LABELS[key] ?? key} ${enabled ? "enabled" : "disabled"}` });
    queryClient.invalidateQueries({ queryKey: ["admin-feature-flags"] });
    queryClient.invalidateQueries({ queryKey: ["app-feature-flags"] });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const rows = FEATURE_FLAG_KEYS.map((key) => ({
    key,
    row: (data ?? []).find((d) => d.key === key),
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Flag className="h-4 w-4" />
            Feature flags
          </CardTitle>
          <CardDescription>
            {INTL_BUILD_ENABLED
              ? "The international bundle is compiled into this build. Runtime flags below control what is live."
              : "The international bundle is disabled at build time (VITE_ENABLE_INTL is not \"true\"), so these flags have no effect yet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {rows.map(({ key, row }) => (
            <div key={key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium">{LABELS[key] ?? key}</p>
                <p className="text-xs text-muted-foreground">{row?.description ?? key}</p>
              </div>
              <Switch
                checked={!!row?.enabled}
                disabled={!row}
                onCheckedChange={(v) => toggle(key, v)}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
