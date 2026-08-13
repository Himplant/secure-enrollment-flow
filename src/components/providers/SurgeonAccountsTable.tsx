import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MoreHorizontal } from "lucide-react";
import { callProviderFn, type ProviderAccount, type ProviderEnvironment } from "./useProviderSetup";

const MANUAL_FIELDS = [
  { key: "access_token", label: "Access Token", required: true },
  { key: "refresh_token", label: "Refresh Token", required: false },
  { key: "public_key", label: "Public Key", required: false },
  { key: "client_id", label: "Client ID", required: false },
  { key: "client_secret", label: "Client Secret", required: false },
  { key: "webhook_secret", label: "Webhook secret", required: false },
];

const PROVIDER_LABEL: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  paypal: "PayPal",
  stripe_connect: "Stripe",
};

const CONNECT_LABEL: Record<string, string> = {
  mercado_pago: "Connect with Mercado Pago",
  paypal: "Start PayPal onboarding",
  stripe_connect: "Start Stripe onboarding",
};

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

function statusVariant(status: string) {
  if (status === "connected") return "default" as const;
  if (["expired", "revoked", "disabled"].includes(status)) return "destructive" as const;
  return "secondary" as const;
}

export function SurgeonAccountsTable({
  provider,
  providerLabel,
  scope = "admin",
  environment,
  accounts,
  surgeons,
  onChanged,
}: {
  provider: string;
  providerLabel?: string;
  scope?: "admin" | "portal";
  environment: ProviderEnvironment;
  accounts: ProviderAccount[];
  surgeons: { id: string; name: string; country: string | null }[];
  onChanged: () => void;
}) {
  const label = providerLabel ?? PROVIDER_LABEL[provider] ?? provider;
  // Manual credential entry is an admin-managed escape hatch for Mercado Pago
  // only. PayPal and Stripe onboard through their own hosted flows, and portal
  // surgeons always self-connect.
  const allowManualCredentials = scope === "admin" && provider === "mercado_pago";
  const connectLabel = CONNECT_LABEL[provider]
    ? CONNECT_LABEL[provider]
    : `Connect with ${label}`;
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualFor, setManualFor] = useState<{ surgeonId: string } | null>(null);
  const [rotateFor, setRotateFor] = useState<ProviderAccount | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: "disconnect" | "set-active"; account: ProviderAccount } | null
  >(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [connectSurgeon, setConnectSurgeon] = useState("");

  const rows = accounts.filter((a) => a.provider === provider);

  const act = async (id: string | null, fn: () => Promise<void>) => {
    setBusyId(id ?? "global");
    try {
      await fn();
      onChanged();
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const connect = () =>
    act(null, async () => {
      if (!connectSurgeon) throw new Error("Pick a surgeon first");
      const res = await callProviderFn<{ url: string }>("provider-connect-start", {
        provider,
        surgeonId: connectSurgeon,
        environment,
        origin: scope,
      });
      window.location.href = res.url;
    });

  const saveManual = () =>
    act(null, async () => {
      await callProviderFn("provider-save-manual-credentials", {
        provider,
        surgeonId: manualFor!.surgeonId,
        environment,
        credentials: creds,
      });
      toast({ title: "Credentials saved", description: "Run a connection test to verify them." });
      setManualFor(null);
      setCreds({});
    });

  const rotate = () =>
    act(rotateFor!.id, async () => {
      await callProviderFn("provider-rotate-credentials", {
        accountId: rotateFor!.id,
        environment,
        credentials: creds,
      });
      toast({ title: "Credentials rotated" });
      setRotateFor(null);
      setCreds({});
    });

  const simple = (name: string, account: ProviderAccount, successTitle: string) =>
    act(account.id, async () => {
      const res = await callProviderFn<{ ok?: boolean; error?: string }>(name, {
        accountId: account.id,
        environment,
      });
      toast({
        title: res.ok === false ? "Failed" : successTitle,
        description: res.error,
        variant: res.ok === false ? "destructive" : "default",
      });
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-64 space-y-1.5">
          <Label>Surgeon</Label>
          <Select value={connectSurgeon} onValueChange={setConnectSurgeon}>
            <SelectTrigger>
              <SelectValue placeholder="Select a surgeon" />
            </SelectTrigger>
            <SelectContent>
              {surgeons.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} {s.country ? `— ${s.country}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={connect} disabled={busyId === "global"}>
          {busyId === "global" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {connectLabel}
        </Button>
        {allowManualCredentials && (
          <Button
            variant="outline"
            onClick={() => {
              if (!connectSurgeon) {
                toast({ title: "Pick a surgeon first", variant: "destructive" });
                return;
              }
              setCreds({});
              setManualFor({ surgeonId: connectSurgeon });
            }}
          >
            Enter credentials manually
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Surgeon</TableHead>
            <TableHead>Country</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead>Env</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Merchant ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last verified</TableHead>
            <TableHead>Active</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                No connected accounts yet.
              </TableCell>
            </TableRow>
          )}
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.surgeons?.name ?? "—"}</TableCell>
              <TableCell>{a.country}</TableCell>
              <TableCell>{a.currency}</TableCell>
              <TableCell>{a.environment}</TableCell>
              <TableCell>{a.connection_method}</TableCell>
              <TableCell className="font-mono text-xs">{a.external_merchant_id ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={statusVariant(a.status)}>{a.status}</Badge>
                {a.connection_error && (
                  <p className="mt-1 max-w-48 text-xs text-destructive">{a.connection_error}</p>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{fmt(a.last_verified_at)}</TableCell>
              <TableCell>{a.is_active ? <Badge>Active</Badge> : "—"}</TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={busyId === a.id}>
                      {busyId === a.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MoreHorizontal className="h-4 w-4" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => simple("provider-test-connection", a, "Connection verified")}>
                      Test connection
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => simple("provider-refresh-status", a, "Status refreshed")}>
                      Refresh status
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setConfirm({ kind: "set-active", account: a })}>
                      Set as active provider
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setCreds({});
                        setRotateFor(a);
                      }}
                    >
                      Rotate credentials
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setConfirm({ kind: "disconnect", account: a })}
                    >
                      Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Manual credentials */}
      <Dialog open={!!manualFor} onOpenChange={(v) => !v && setManualFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter {label} credentials</DialogTitle>
            <DialogDescription>
              Values are encrypted immediately and never shown again. Only an indicator such as
              ••••1234 is displayed afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {MANUAL_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>
                  {f.label}
                  {!f.required && <span className="ml-2 text-xs text-muted-foreground">optional</span>}
                </Label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={creds[f.key] ?? ""}
                  onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualFor(null)}>
              Cancel
            </Button>
            <Button onClick={saveManual} disabled={!creds.access_token}>
              Save securely
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rotate */}
      <Dialog open={!!rotateFor} onOpenChange={(v) => !v && setRotateFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate credentials</DialogTitle>
            <DialogDescription>
              Leave everything blank to rotate through the stored refresh token, or paste new values to
              replace them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {MANUAL_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>{f.label}</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={creds[f.key] ?? ""}
                  onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateFor(null)}>
              Cancel
            </Button>
            <Button onClick={rotate}>Rotate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmations */}
      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "disconnect" ? "Disconnect this account?" : "Make this the active provider?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "disconnect"
                ? "Stored credentials are destroyed and new consultation links can no longer settle to this account. Existing payments are unaffected."
                : "New consultation links for this surgeon will settle through this account."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const c = confirm!;
                setConfirm(null);
                simple(
                  c.kind === "disconnect" ? "provider-disconnect" : "provider-set-active",
                  c.account,
                  c.kind === "disconnect" ? "Disconnected" : "Active provider updated",
                );
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
