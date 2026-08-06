import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { PlatformConfigCard } from "./PlatformConfigCard";
import { SurgeonAccountsTable } from "./SurgeonAccountsTable";
import { useProviderSetup, type ProviderEnvironment } from "./useProviderSetup";

const PROVIDER_TABS = [
  { id: "mercado_pago", label: "Mercado Pago" },
  { id: "paypal", label: "PayPal" },
  { id: "stripe_connect", label: "Stripe" },
];

/**
 * Shared provider setup shell used by both the admin International Setup tab
 * and the surgeon portal. Platform credential controls render only for
 * Himplant super admins; surgeons see just their own connected accounts.
 */
export function ProviderSetupPanel({ scope }: { scope: "admin" | "portal" }) {
  const [environment, setEnvironment] = useState<ProviderEnvironment>("sandbox");
  const [tab, setTab] = useState("mercado_pago");
  const { data, isLoading, isFetching, error, refresh } = useProviderSetup(environment);

  const { data: surgeons } = useQuery({
    queryKey: ["intl-surgeons-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surgeons")
        .select("id, name, country")
        .eq("is_international", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const allowedSurgeons = (surgeons ?? []).filter(
    (s) =>
      scope === "admin" ||
      (data?.accounts ?? []).some((a) => a.surgeon_id === s.id) ||
      data?.actor.canManagePlatform,
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Provider setup unavailable</AlertTitle>
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Payment providers</h3>
          <p className="text-sm text-muted-foreground">
            Connect each surgeon's own merchant account. Funds settle directly to the surgeon.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={environment} onValueChange={(v) => setEnvironment(v as ProviderEnvironment)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sandbox">Test / sandbox</SelectItem>
              <SelectItem value="live">Production</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {PROVIDER_TABS.map((p) => {
            const entry = data?.platform.find((e) => e.provider === p.id);
            const implemented = entry?.implemented ?? p.id === "mercado_pago";
            return (
              <TabsTrigger key={p.id} value={p.id} className="gap-2">
                {p.label}
                {!implemented && (
                  <Badge variant="secondary" className="text-[10px]">
                    pending
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {PROVIDER_TABS.map((p) => {
          const entry = data?.platform.find((e) => e.provider === p.id);
          const implemented = entry?.implemented ?? p.id === "mercado_pago";
          return (
            <TabsContent key={p.id} value={p.id} className="space-y-4 pt-4">
              {!implemented ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{p.label}</CardTitle>
                    <CardDescription>
                      Implementation pending — this provider cannot accept consultation payments yet.
                    </CardDescription>
                  </CardHeader>
                </Card>
              ) : (
                <>
                  {data?.actor.canManagePlatform && entry && (
                    <PlatformConfigCard entry={entry} environment={environment} onSaved={refresh} />
                  )}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Surgeon accounts</CardTitle>
                      <CardDescription>
                        Each surgeon authorizes their own {p.label} seller account. Nothing is marked
                        connected until a live connection test succeeds.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <SurgeonAccountsTable
                        provider={p.id}
                        environment={environment}
                        accounts={data?.accounts ?? []}
                        surgeons={allowedSurgeons}
                        onChanged={refresh}
                      />
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
