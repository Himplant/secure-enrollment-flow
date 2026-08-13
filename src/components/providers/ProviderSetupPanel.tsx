import { useEffect, useState } from "react";
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

export const PROVIDER_LABELS: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  paypal: "PayPal",
  stripe_connect: "Stripe",
};

/**
 * Shared provider setup shell used by both the admin International hub
 * (Advanced setup → Payment providers) and the surgeon portal.
 *
 * The list of provider tabs comes ENTIRELY from the server, which returns only
 * providers whose runtime feature flag is on. A disabled provider is never
 * rendered here and its mutation endpoints reject it as well.
 */
export function ProviderSetupPanel({ scope }: { scope: "admin" | "portal" }) {
  // Production is the operational default. Sandbox is QA-only and must never
  // be the path an operator lands on while preparing a real launch.
  const [environment, setEnvironment] = useState<ProviderEnvironment>("live");
  const [tab, setTab] = useState<string>("");
  const { data, isLoading, isFetching, error, refresh } = useProviderSetup(environment);

  // The server returns the caller's validated scope. Never derive it here —
  // that is what previously hid surgeons with zero connected accounts.
  const allowedSurgeons = data?.surgeons ?? [];
  const providers = (data?.platform ?? []).map((p) => p.provider);

  useEffect(() => {
    if (providers.length && !providers.includes(tab)) setTab(providers[0]);
  }, [providers, tab]);

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
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="live">Production (real payments)</SelectItem>
              <SelectItem value="sandbox">Test / sandbox — QA only</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {environment === "sandbox" && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>You are viewing the QA sandbox</AlertTitle>
          <AlertDescription>
            Sandbox accounts can never take a real patient payment. Switch to Production to prepare a
            live launch.
          </AlertDescription>
        </Alert>
      )}

      {providers.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No payment provider is enabled</CardTitle>
            <CardDescription>
              No payment provider is currently switched on, so there is nothing to set up.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {(data?.platform ?? []).map((entry) => (
              <TabsTrigger key={entry.provider} value={entry.provider} className="gap-2">
                {PROVIDER_LABELS[entry.provider] ?? entry.provider}
                {!entry.implemented && (
                  <Badge variant="secondary" className="text-[10px]">
                    pending
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {(data?.platform ?? []).map((entry) => {
            const label = PROVIDER_LABELS[entry.provider] ?? entry.provider;
            return (
              <TabsContent key={entry.provider} value={entry.provider} className="space-y-4 pt-4">
                {!entry.implemented ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{label}</CardTitle>
                      <CardDescription>
                        Implementation pending — this provider cannot accept consultation payments yet.
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ) : (
                  <>
                    {data?.actor.canManagePlatform && (
                      <PlatformConfigCard entry={entry} environment={environment} onSaved={refresh} />
                    )}
                    {scope === "portal" && entry.platformReady === false && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>{label} is not ready yet</AlertTitle>
                        <AlertDescription>
                          Himplant has not finished the {label} platform setup for the{" "}
                          {environment === "live" ? "production" : "test"} environment. You can connect
                          your account as soon as that is complete.
                        </AlertDescription>
                      </Alert>
                    )}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Surgeon accounts</CardTitle>
                        <CardDescription>
                          Each surgeon authorizes their own {label} seller account. Nothing is marked
                          connected until a live connection test succeeds.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <SurgeonAccountsTable
                          provider={entry.provider}
                          providerLabel={label}
                          scope={scope}
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
      )}
    </div>
  );
}
