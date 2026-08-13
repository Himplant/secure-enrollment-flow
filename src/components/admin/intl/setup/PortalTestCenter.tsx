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
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface QaDemoUser {
  email: string;
  exists: boolean;
  is_active: boolean;
  accepted: boolean;
  last_login_at: string | null;
  memberships: { org_type: string; role: string; is_active: boolean }[];
}

interface QaStatus {
  qa_enabled: boolean;
  fixture_set_id: string;
  counts: Record<string, number>;
  demo_users: QaDemoUser[];
}

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Portal Test Center</h3>
          <p className="text-sm text-muted-foreground">
            Deterministic demo accounts and consultation fixtures for international QA.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={busy}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

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
                  <TableCell className="font-mono text-xs">{u.email}</TableCell>
                  <TableCell>
                    {!u.exists ? (
                      <Badge variant="secondary">Not created</Badge>
                    ) : u.is_active ? (
                      <Badge>Active</Badge>
                    ) : (
                      <Badge variant="outline">Disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell className="space-x-1">
                    {u.memberships.length === 0 && <span className="text-muted-foreground">—</span>}
                    {u.memberships.map((m, i) => (
                      <Badge key={i} variant={m.is_active ? "secondary" : "outline"} className="text-[10px]">
                        {m.role}
                      </Badge>
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
