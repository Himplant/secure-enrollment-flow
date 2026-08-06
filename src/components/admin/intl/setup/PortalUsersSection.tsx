import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionCard, EmptyRow, Spinner } from "./shared";

const SURGEON_ROLES = ["surgeon_admin", "surgeon_staff", "surgeon_analyst"] as const;
const DISTRIBUTOR_ROLES = ["distributor_admin", "distributor_staff", "distributor_analyst"] as const;
type PortalRole = (typeof SURGEON_ROLES)[number] | (typeof DISTRIBUTOR_ROLES)[number];

interface MembershipRow {
  id: string;
  role: PortalRole;
  is_active: boolean;
  surgeon: { name: string } | null;
  distributor: { name: string } | null;
}

export function PortalUsersSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    email: "",
    full_name: "",
    org_type: "surgeon",
    surgeon_id: "",
    distributor_id: "",
    role: "surgeon_admin",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["portal-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portal_users")
        .select(
          "id, email, full_name, is_active, accepted_at, portal_memberships(id, role, is_active, surgeon:surgeons(name), distributor:distributors(name))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: surgeons } = useQuery({
    queryKey: ["intl-surgeons-min"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surgeons")
        .select("id, name")
        .eq("is_international", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: distributors } = useQuery({
    queryKey: ["intl-distributors-min"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("distributors").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  /** All identity writes go through the service-role edge function. */
  const callIdentity = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("intl-portal-identity", { body });
    const payload = data as { error?: string } | null;
    if (error || payload?.error) throw new Error(payload?.error ?? error?.message ?? "Request failed");
    return payload;
  };

  const save = async () => {
    const email = form.email.trim().toLowerCase();
    const scopeId = form.org_type === "surgeon" ? form.surgeon_id : form.distributor_id;
    if (!email || !scopeId) {
      toast({ title: "Email and organisation are required", variant: "destructive" });
      return;
    }

    try {
      const res = (await callIdentity({
        action: "invite",
        email,
        full_name: form.full_name.trim() || null,
        org_type: form.org_type,
        surgeon_id: form.org_type === "surgeon" ? form.surgeon_id : null,
        distributor_id: form.org_type === "distributor" ? form.distributor_id : null,
        role: form.role,
      })) as { invite?: { sent: boolean; mode: string } };

      toast({
        title: "Portal access granted",
        description: res?.invite?.sent
          ? `An invitation email was sent to ${email}.`
          : `${email} already has a sign-in — they can use their existing password or "Forgot password".`,
      });
      setOpen(false);
      setForm({ email: "", full_name: "", org_type: "surgeon", surgeon_id: "", distributor_id: "", role: "surgeon_admin" });
      qc.invalidateQueries({ queryKey: ["portal-users"] });
    } catch (e) {
      toast({
        title: "Could not grant access",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const resend = async (portalUserId: string) => {
    try {
      await callIdentity({ action: "resend_invite", portal_user_id: portalUserId });
      toast({ title: "Invitation resent" });
    } catch (e) {
      toast({
        title: "Could not resend",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  /** Revokes every membership; the auth identity itself is left intact. */
  const remove = async (u: { id: string; portal_memberships?: unknown }) => {
    try {
      const memberships = ((u.portal_memberships ?? []) as unknown as MembershipRow[]) ?? [];
      for (const m of memberships) {
        await callIdentity({ action: "remove_membership", membership_id: m.id });
      }
      toast({ title: "Portal access revoked" });
      qc.invalidateQueries({ queryKey: ["portal-users"] });
    } catch (e) {
      toast({
        title: "Could not revoke access",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };


  const roles = form.org_type === "surgeon" ? SURGEON_ROLES : DISTRIBUTOR_ROLES;

  return (
    <SectionCard
      title="Portal users"
      description="Surgeon and distributor contacts who can sign in at /portal/login and manage their own consultations."
      action={
        <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Grant access
        </Button>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <EmptyRow colSpan={5} text="No portal users yet." />}
            {(data ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.email}</TableCell>
                <TableCell className="text-muted-foreground">{u.full_name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {((u.portal_memberships ?? []) as unknown as MembershipRow[])
                    .map((m) => `${m.surgeon?.name ?? m.distributor?.name ?? "—"} (${m.role.replace(/_/g, " ")})`)
                    .join(", ") || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={u.accepted_at ? "default" : "secondary"}>
                    {u.accepted_at ? "Active" : "Invited"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => remove(u.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant portal access</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Organisation type</Label>
                <Select
                  value={form.org_type}
                  onValueChange={(v) =>
                    setForm({ ...form, org_type: v, role: v === "surgeon" ? "surgeon_admin" : "distributor_admin" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="surgeon">Surgeon</SelectItem>
                    <SelectItem value="distributor">Distributor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{form.org_type === "surgeon" ? "Surgeon" : "Distributor"}</Label>
              {form.org_type === "surgeon" ? (
                <Select value={form.surgeon_id} onValueChange={(v) => setForm({ ...form, surgeon_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a surgeon" />
                  </SelectTrigger>
                  <SelectContent>
                    {(surgeons ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={form.distributor_id} onValueChange={(v) => setForm({ ...form, distributor_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a distributor" />
                  </SelectTrigger>
                  <SelectContent>
                    {(distributors ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Grant access</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
