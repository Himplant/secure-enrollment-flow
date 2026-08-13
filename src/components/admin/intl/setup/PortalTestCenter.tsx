import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface QaDemoUser {
  email: string;
  exists: boolean;
  is_active: boolean;
  accepted: boolean;
  last_login_at: string | null;
  memberships: { org_type: string; role: string; is_active: boolean; org_name?: string | null }[];
}

interface QaStatus {
  qa_enabled: boolean;
  fixture_set_id: string;
  counts: Record<string, number>;
  demo_users: QaDemoUser[];
}

/** Role-by-role acceptance script for the deterministic demo identities. */
export const ROLE_TEST_GUIDE = [
  {
    email: "qa.multi.admin@himplant.com",
    workspace: "Surgeon workspace (chosen at the workspace picker, then MFA)",
    navigation: "Consultations, Reports, Team, Payment account",
    allowed: "Update a consultation status and manage the surgeon's team members",
    forbidden: "Seeing consultations of unmapped or other surgeons",
  },
  {
    email: "qa.multi.admin@himplant.com",
    workspace: "Distributor workspace (switch workspace, then MFA)",
    navigation: "Overview, Consultations, Team",
    allowed: "Manage the distributor's team members",
    forbidden: "Editing a consultation or any payment credentials",
  },
  {
    email: "qa.surgeon.staff@himplant.com",
    workspace: "Own surgeon workspace (no workspace picker)",
    navigation: "Consultations, Reports",
    allowed: "Operational consultation updates (contacted, scheduled, resend link)",
    forbidden: "Team management and payment account configuration",
  },
  {
    email: "qa.surgeon.analyst@himplant.com",
    workspace: "Own surgeon workspace",
    navigation: "Consultations, Reports (read-only)",
    allowed: "Viewing consultations and reports",
    forbidden: "Any write — status updates, resend link, team, payment config",
  },
  {
    email: "qa.distributor.staff@himplant.com",
    workspace: "Distributor workspace",
    navigation: "Overview, Consultations",
    allowed: "Viewing distributor rollups and in-scope consultations",
    forbidden: "Consultation updates and payment account configuration",
  },
  {
    email: "qa.distributor.analyst@himplant.com",
    workspace: "Distributor workspace",
    navigation: "Overview, Consultations, Reports (read-only)",
    allowed: "Reading distributor reporting",
    forbidden: "Any write of any kind",
  },
] as const;

/** Guidance-only checklist — no step here is simulated or auto-approved. */
export const REAL_PAYMENT_SMOKE_TEST = [
  "Configure LIVE Mercado Pago platform credentials (production application).",
  "Configure the production webhook URL and webhook secret in the platform config.",
  "Connect and verify a LIVE Colombian surgeon seller account (Test connection must pass).",
  "Set Mercado Pago as the active provider for that surgeon.",
  "Turn the CO runtime feature flag ON.",
  "Turn the CO country setting ON — only when everything above is ready.",
  "Ensure mercado_pago is in the CO allowed providers list.",
  "Ensure an active Spanish-language CO policy is published.",
  "Create a small real COP consultation for a real test patient.",
  "Open the patient link, accept the terms, sign, and pay with a real method.",
  "Confirm the money actually reached the seller's Mercado Pago account.",
  "Confirm the webhook was processed and the Himplant payment status becomes approved.",
  "Confirm the portal moves the consultation to awaiting clinic contact.",
  "Confirm the Zoho outbox drains and the CRM record syncs.",
] as const;


const call = async (payload: Record<string, unknown>): Promise<QaStatus> => {
  const { data, error } = await supabase.functions.invoke<QaStatus & { error?: string }>(
    "intl-qa-fixtures",
    { body: payload },
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as QaStatus;
};

/**
 * Portal Test Center — creates deterministic international demo identities and
 * fixture consultations so every portal role can be exercised end to end.
 * Everything it creates is tagged and removable in one click. It never touches
 * U.S. enrollment data.
 */
export function PortalTestCenter() {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirmCleanup, setConfirmCleanup] = useState(false);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["intl-qa-status"],
    queryFn: () => call({ action: "status" }),
  });

  const run = useMutation({
    mutationFn: (payload: Record<string, unknown>) => call(payload),
    onSuccess: (result, variables) => {
      qc.setQueryData(["intl-qa-status"], result);
      toast({ title: `Done: ${String(variables.action).replace(/_/g, " ")}` });
      setPassword("");
    },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
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
        <AlertTitle>Portal Test Center unavailable</AlertTitle>
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  const busy = run.isPending || isFetching;

  const copyEmail = async (email: string) => {
    await navigator.clipboard.writeText(email);
    toast({ title: "Email copied", description: email });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Portal Test Center</h3>
          <p className="text-sm text-muted-foreground">
            Deterministic demo accounts and consultation fixtures for international QA.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(`${window.location.origin}/portal/login`, "_blank", "noopener")}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open portal login
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={busy}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Use a private / incognito window</AlertTitle>
        <AlertDescription>
          The portal shares this origin's session storage, so signing in as a demo user in this
          browser profile will replace your admin session. Open the portal login in a private window
          for testing.
        </AlertDescription>
      </Alert>



      {!data?.qa_enabled && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>QA mode is off</AlertTitle>
          <AlertDescription>
            Enable <code>international_portal_qa_enabled</code> in Platform → Feature flags to use
            these tools. Leave it off in production.
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Test data only</AlertTitle>
        <AlertDescription>
          Fixtures use the internal test payment provider — no real money moves. Every created
          record is tagged so cleanup removes exactly what was added and nothing else. The U.S.
          enrollment flow is untouched.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Demo identities</CardTitle>
          <CardDescription>
            One temporary password is applied to every demo account. It is never stored or shown
            again — keep it out of production.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="qa-password">Temporary password (min 12 chars)</Label>
              <Input
                id="qa-password"
                type="password"
                className="w-72"
                value={password}
                autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button
              disabled={!data?.qa_enabled || busy || password.length < 12}
              onClick={() => run.mutate({ action: "create_demo_users", password })}
            >
              Create / refresh demo users
            </Button>
            <Button
              variant="outline"
              disabled={!data?.qa_enabled || busy}
              onClick={() => run.mutate({ action: "reset_fixtures" })}
            >
              Reset fixture data
            </Button>
            <Button
              variant="outline"
              disabled={!data?.qa_enabled || busy}
              onClick={() => run.mutate({ action: "disable_demo_users" })}
            >
              Disable demo users
            </Button>
            <Button
              variant="destructive"
              disabled={!data?.qa_enabled || busy}
              onClick={() => setConfirmCleanup(true)}
            >
              Delete all test data
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Memberships</TableHead>
                <TableHead>Last login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.demo_users ?? []).map((u) => (
                <TableRow key={u.email}>
                  <TableCell className="font-mono text-xs">
                    <span className="inline-flex items-center gap-1">
                      {u.email}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={`Copy ${u.email}`}
                        onClick={() => copyEmail(u.email)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </TableCell>
                  <TableCell>
                    {!u.exists ? (
                      <Badge variant="secondary">Not created</Badge>
                    ) : u.is_active ? (
                      <Badge>Active</Badge>
                    ) : (
                      <Badge variant="outline">Disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell className="space-y-1">
                    {u.memberships.length === 0 && <span className="text-muted-foreground">—</span>}
                    {u.memberships.map((m, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Badge variant={m.is_active ? "secondary" : "outline"} className="text-[10px]">
                          {m.role}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {m.org_name ?? m.org_type}
                        </span>
                      </div>
                    ))}
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fixture registry</CardTitle>
          <CardDescription>
            Records created by this tool, grouped by table. Cleanup deletes only these.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(data?.counts ?? {}).length === 0 ? (
            <p className="text-sm text-muted-foreground">No fixture records exist yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(data?.counts ?? {}).map(([table, count]) => (
                <Badge key={table} variant="secondary">
                  {table}: {count}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to run the demo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Enable the QA flag, then create the demo users with a temporary password.</li>
            <li>
              Open <code>/portal/login</code> in a private window and sign in as each demo email.
            </li>
            <li>
              <strong>qa.multi.admin</strong> has both a surgeon and a distributor membership — it
              lands on the workspace picker and must complete MFA for either admin workspace.
            </li>
            <li>
              Staff and analyst accounts confirm read-only limits; distributor accounts confirm that
              patient notes and clinical details stay hidden.
            </li>
            <li>Delete all test data when the run is finished.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Role-by-role test guide</CardTitle>
          <CardDescription>
            Sign out between accounts. Also verify that “QA Unmapped Surgeon Colombia” is invisible
            from every distributor account.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Expected landing / workspace</TableHead>
                <TableHead>Expected navigation</TableHead>
                <TableHead>Allowed action</TableHead>
                <TableHead>Forbidden action</TableHead>
                <TableHead>Sign out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROLE_TEST_GUIDE.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">
                    <span className="inline-flex items-center gap-1">
                      {r.email}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={`Copy ${r.email}`}
                        onClick={() => copyEmail(r.email)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{r.workspace}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.navigation}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.allowed}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.forbidden}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Use the account menu → Sign out, then close the private window.
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Real Mercado Pago payment smoke test</CardTitle>
          <CardDescription>
            Guidance only — nothing here is simulated, bypassed or auto-approved. Each step must be
            confirmed manually with the real provider.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            {REAL_PAYMENT_SMOKE_TEST.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </CardContent>
      </Card>



      <AlertDialog open={confirmCleanup} onOpenChange={setConfirmCleanup}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all international test data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every record this tool created — demo accounts, fixture
              surgeons, distributors, patients and consultations. Real international data and the
              entire U.S. enrollment flow are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmCleanup(false);
                run.mutate({ action: "cleanup" });
              }}
            >
              Delete test data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
