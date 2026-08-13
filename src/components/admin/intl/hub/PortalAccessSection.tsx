import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionCard, EmptyRow, Spinner } from "../setup/shared";
import { useIntlNetwork } from "./useIntlNetwork";
import {
  ACCESS_LEVELS,
  accessLevelLabel,
  toAccessLevel,
  toRoleCode,
  type AccessLevel,
  type PortalOrgKind,
} from "@/lib/portalAccessLevels";
import type { PortalRoleName } from "@/lib/portalAccess";

interface MembershipRow {
  id: string;
  role: PortalRoleName;
  is_active: boolean;
  surgeon: { name: string } | null;
  distributor: { name: string } | null;
}

export interface InviteTarget {
  orgType: PortalOrgKind;
  orgId: string;
}

interface Props {
  inviteTarget: InviteTarget | null;
  onInviteHandled: () => void;
}

export function PortalAccessSection({ inviteTarget, onInviteHandled }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: network } = useIntlNetwork();

  const [open, setOpen] = useState(false);
  const [orgFilter, setOrgFilter] = useState("all");
  const [form, setForm] = useState({
    email: "",
    full_name: "",
    org_type: "surgeon" as PortalOrgKind,
    org_id: "",
    level: "admin" as AccessLevel,
  });

  // Row-level "Invite" buttons elsewhere in the hub deep-link into this form
  // with the organisation already chosen.
  useEffect(() => {
    if (!inviteTarget) return;
    setForm({
      email: "",
      full_name: "",
      org_type: inviteTarget.orgType,
      org_id: inviteTarget.orgId,
      level: "admin",
    });
    setOpen(true);
    onInviteHandled();
  }, [inviteTarget, onInviteHandled]);

  const { data, isLoading } = useQuery({
    queryKey: ["portal-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portal_users")
        .select(
          "id, email, full_name, is_active, accepted_at, last_login_at, portal_memberships(id, role, is_active, surgeon:surgeons(name), distributor:distributors(name))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const orgOptions = useMemo(() => {
    if (form.org_type === "surgeon") {
      return (network?.surgeons ?? []).map((s) => ({ id: s.id, name: s.name }));
    }
    return (network?.distributors ?? []).filter((d) => d.is_active).map((d) => ({ id: d.id, name: d.name }));
  }, [network, form.org_type]);

  const callIdentity = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("intl-portal-identity", { body });
    const payload = data as { error?: string } | null;
    if (error || payload?.error) throw new Error(payload?.error ?? error?.message ?? "Request failed");
    return payload;
  };

  const save = async () => {
    const email = form.email.trim().toLowerCase();
    if (!email || !form.org_id) {
      toast({ title: "Email and organisation are required", variant: "destructive" });
      return;
    }
    try {
      const res = (await callIdentity({
        action: "invite",
        email,
        full_name: form.full_name.trim() || null,
        org_type: form.org_type,
        surgeon_id: form.org_type === "surgeon" ? form.org_id : null,
        distributor_id: form.org_type === "distributor" ? form.org_id : null,
        role: toRoleCode(form.org_type, form.level),
      })) as { invite?: { sent: boolean } };

      toast({
        title: "Invitation sent",
        description: res?.invite?.sent
          ? `${email} will receive an email with sign-in instructions.`
          : `${email} already has a sign-in — they can use their existing password.`,
      });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["portal-users"] });
    } catch (e) {
      toast({
        title: "Could not send invitation",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const resend = async (id: string) => {
    try {
      await callIdentity({ action: "resend_invite", portal_user_id: id });
      toast({ title: "Invitation resent" });
    } catch (e) {
      toast({
        title: "Could not resend",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const revoke = async (u: { portal_memberships?: unknown }) => {
    try {
      for (const m of (u.portal_memberships ?? []) as MembershipRow[]) {
        await callIdentity({ action: "remove_membership", membership_id: m.id });
      }
      toast({ title: "Access revoked" });
      qc.invalidateQueries({ queryKey: ["portal-users"] });
    } catch (e) {
      toast({
        title: "Could not revoke access",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const orgNames = useMemo(() => {
    const set = new Set<string>();
    for (const u of data ?? []) {
      for (const m of (u.portal_memberships ?? []) as unknown as MembershipRow[]) {
        const n = m.surgeon?.name ?? m.distributor?.name;
        if (n) set.add(n);
      }
    }
    return [...set].sort();
  }, [data]);

  const rows = (data ?? []).filter((u) =>
    orgFilter === "all"
      ? true
      : ((u.portal_memberships ?? []) as unknown as MembershipRow[]).some(
          (m) => (m.surgeon?.name ?? m.distributor?.name) === orgFilter,
        ),
  );

  const loginUrl = typeof window === "undefined" ? "/portal/login" : `${window.location.origin}/portal/login`;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{loginUrl}</p>
            <p className="text-xs text-muted-foreground">
              Surgeons and distributors use the same portal login. Their invitation determines what they can see.
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(loginUrl);
                toast({ title: "Login link copied" });
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="/portal/login" target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <SectionCard
        title="People with portal access"
        description="Invite the people who work on consultations. Access level decides what they can do."
        action={
          <Button
            size="sm"
            className="gap-2"
            onClick={() => {
              setForm({ email: "", full_name: "", org_type: "surgeon", org_id: "", level: "admin" });
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Invite someone
          </Button>
        }
      >
        <div className="mb-4 max-w-xs">
          <Select value={orgFilter} onValueChange={setOrgFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All organisations</SelectItem>
              {orgNames.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <Spinner />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Access level</TableHead>
                <TableHead>Invitation</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <EmptyRow colSpan={6} text="Nobody has portal access yet." />}
              {rows.map((u) => {
                const memberships = (u.portal_memberships ?? []) as unknown as MembershipRow[];
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.email}</div>
                      <div className="text-xs text-muted-foreground">{u.full_name ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {memberships.map((m) => m.surgeon?.name ?? m.distributor?.name ?? "—").join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {memberships.map((m) => accessLevelLabel(toAccessLevel(m.role))).join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.accepted_at ? "default" : "secondary"}>
                        {u.accepted_at ? "Accepted" : "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "Never"}
                    </TableCell>
                    <TableCell className="flex items-center gap-1">
                      {!u.accepted_at && (
                        <Button variant="ghost" size="sm" onClick={() => resend(u.id)}>
                          Resend
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => revoke(u)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite someone to the portal</DialogTitle>
            <DialogDescription>They will receive an email with a link to set their password.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Account type</Label>
              <Select
                value={form.org_type}
                onValueChange={(v) => setForm({ ...form, org_type: v as PortalOrgKind, org_id: "" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="surgeon">Surgeon practice</SelectItem>
                  <SelectItem value="distributor">Distributor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Organisation</Label>
              <Select value={form.org_id} onValueChange={(v) => setForm({ ...form, org_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an organisation" />
                </SelectTrigger>
                <SelectContent>
                  {orgOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Access level</Label>
              <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v as AccessLevel })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCESS_LEVELS.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ACCESS_LEVELS.find((l) => l.value === form.level)?.description(form.org_type)}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Send invitation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
