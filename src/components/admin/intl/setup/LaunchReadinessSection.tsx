import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { INTL_BUILD_ENABLED } from "@/lib/featureFlags";


type CheckStatus = "green" | "warning" | "blocked";

interface ReadinessCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  next_action: string | null;
}

interface CountrySetting {
  country: string;
  is_enabled: boolean;
  default_currency: string;
  default_language: string;
  allowed_providers: string[];
  link_expiry_hours: number;
  sla_first_contact_hours: number;
}

interface ProviderMatrixEnv {
  environment: string;
  exists: boolean;
  is_complete: boolean;
  missing_fields: string[];
  last_verified_at: string | null;
  webhook_url: string | null;
  connected_accounts: number;
  active_accounts: number;
}

interface ReadinessPayload {
  country: string;
  environment: string;
  checks: ReadinessCheck[];
  country_settings: CountrySetting[];
  provider_matrix: { provider: string; environments: ProviderMatrixEnv[] }[];
  mercado_pago_base_webhook_url: string;
}

const COUNTRIES = [
  { value: "CO", label: "Colombia" },
  { value: "MX", label: "Mexico" },
  { value: "CL", label: "Chile" },
];

const STATUS_META: Record<CheckStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  green: { icon: CheckCircle2, className: "text-emerald-600", label: "Ready" },
  warning: { icon: AlertTriangle, className: "text-amber-600", label: "Warning" },
  blocked: { icon: XCircle, className: "text-destructive", label: "Blocked" },
};

/** The only providers a country may be configured to accept. */
export const SELECTABLE_PROVIDERS = ["test", "mercado_pago", "paypal", "stripe_connect"] as const;

/**
 * Build-time gate. The edge function cannot see Vite's build flags, so this row
 * is evaluated in the browser from the compiled bundle.
 */
export function buildGateCheck(): ReadinessCheck {
  return {
    id: "intl_build_flag",
    label: "International bundle compiled (VITE_ENABLE_INTL)",
    status: INTL_BUILD_ENABLED ? "green" : "blocked",
    detail: INTL_BUILD_ENABLED
      ? "Enabled — the international UI is present in this build."
      : "Disabled — this build excludes the international portal and consultation screens.",
    next_action: INTL_BUILD_ENABLED
      ? null
      : "Set VITE_ENABLE_INTL=true and rebuild/redeploy the frontend before launch.",
  };
}

/**
 * Launch readiness for the international module. Read-only gates plus the
 * super-admin-only country controls (`is_enabled`, allowed providers) so an
 * operator can fix a silent blocker without leaving the page.
 */
export function LaunchReadinessSection() {
  const qc = useQueryClient();
  const [country, setCountry] = useState("CO");
  const [environment, setEnvironment] = useState("live");

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["intl-launch-readiness", country, environment],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<ReadinessPayload>(
        "intl-launch-readiness",
        { body: { country, environment } },
      );
      if (error) throw error;
      if ((data as unknown as { error?: string })?.error) {
        throw new Error((data as unknown as { error: string }).error);
      }
      return data as ReadinessPayload;
    },
  });

  // Every country mutation goes through the edge function, which re-checks
  // super_admin + AAL2 server-side and returns refreshed readiness.
  const mutateCountry = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke<ReadinessPayload & { error?: string }>(
        "intl-launch-readiness",
        { body: { country, environment, ...payload } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as ReadinessPayload;
    },
    onSuccess: (result) => {
      toast({ title: "Country settings updated" });
      qc.setQueryData(["intl-launch-readiness", country, environment], result);
      qc.invalidateQueries({ queryKey: ["intl-launch-readiness"] });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });


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
        <AlertTitle>Launch readiness unavailable</AlertTitle>
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  // The build gate is client-side only, but it counts as a real blocker.
  const checks: ReadinessCheck[] = [buildGateCheck(), ...(data?.checks ?? [])];
  const blocked = checks.filter((c) => c.status === "blocked").length;


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Launch readiness</h3>
          <p className="text-sm text-muted-foreground">
            Every gate that must be green before international consultations can go live.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={environment} onValueChange={setEnvironment}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sandbox">Test / sandbox</SelectItem>
              <SelectItem value="live">Production</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Alert variant={blocked ? "destructive" : "default"}>
        {blocked ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        <AlertTitle>
          {blocked
            ? `${blocked} blocker${blocked === 1 ? "" : "s"} for ${country} (${environment})`
            : `No blockers for ${country} (${environment})`}
        </AlertTitle>
        <AlertDescription>
          {blocked
            ? "Resolve every blocked item below before enabling the country for real patients."
            : "All required gates pass. Warnings are safe to launch with, but review them."}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Checks</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Status</TableHead>
                <TableHead>Gate</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Next action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.checks ?? []).map((c) => {
                const meta = STATUS_META[c.status];
                const Icon = meta.icon;
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <span className={`flex items-center gap-1.5 text-sm font-medium ${meta.className}`}>
                        <Icon className="h-4 w-4" />
                        {meta.label}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{c.label}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.detail}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.next_action ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Country availability</CardTitle>
          <CardDescription>
            A country that is switched off here blocks consultation creation even when its feature
            flag is on.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Country</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Allowed providers</TableHead>
                <TableHead>Link expiry</TableHead>
                <TableHead className="text-right">Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.country_settings ?? []).map((s) => (
                <TableRow key={s.country}>
                  <TableCell className="font-medium">{s.country}</TableCell>
                  <TableCell>{s.default_currency}</TableCell>
                  <TableCell>{s.default_language}</TableCell>
                  <TableCell className="space-x-1">
                    {(s.allowed_providers ?? []).map((p) => (
                      <Badge key={p} variant="secondary" className="text-[10px]">
                        {p}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>{s.link_expiry_hours}h</TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={s.is_enabled}
                      disabled={toggleCountry.isPending}
                      onCheckedChange={(v) => toggleCountry.mutate({ code: s.country, enabled: v })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider readiness — sandbox vs production</CardTitle>
          <CardDescription>
            Sandbox and production are fully separate configurations. Connecting one never affects
            the other.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Platform config</TableHead>
                <TableHead>Connected accounts</TableHead>
                <TableHead>Last verified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.provider_matrix ?? []).flatMap((p) =>
                p.environments.map((e) => (
                  <TableRow key={`${p.provider}-${e.environment}`}>
                    <TableCell className="font-medium">{p.provider}</TableCell>
                    <TableCell>{e.environment}</TableCell>
                    <TableCell className="text-sm">
                      {!e.exists ? (
                        <span className="text-muted-foreground">Not configured</span>
                      ) : e.is_complete ? (
                        <span className="text-emerald-600">Complete</span>
                      ) : (
                        <span className="text-amber-600">
                          Missing: {e.missing_fields.join(", ") || "unknown"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.active_accounts} active / {e.connected_accounts} connected
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {e.last_verified_at ? new Date(e.last_verified_at).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mercado Pago webhook URL</CardTitle>
          <CardDescription>
            Paste this into the Mercado Pago application. Environment and seller routing are added
            automatically per payment link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block break-all rounded bg-muted px-3 py-2 text-xs">
            {data?.mercado_pago_base_webhook_url}
          </code>
        </CardContent>
      </Card>
    </div>
  );
}
