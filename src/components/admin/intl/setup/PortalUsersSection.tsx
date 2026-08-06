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

const CLINIC_ROLES = ["clinic_admin", "clinic_staff", "clinic_analyst"] as const;
const DISTRIBUTOR_ROLES = ["distributor_admin", "distributor_staff", "distributor_analyst"] as const;

export function PortalUsersSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    email: "", full_name: "", org_type: "clinic", clinic_id: "", distributor_id: "", role: "clinic_admin",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["portal-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portal_users")
        .select("id, email, full_name, is_active, accepted_at, portal_memberships(id, role, is_active, clinic:clinics(name), distributor:distributors(name))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: clinics } = useQuery({
    queryKey: ["intl-clinics-setup-min"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("clinics").select("id, name").order("name");
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

  const save = async () => {
    const email = form.email.trim().toLowerCase();
    const scopeId = form.org_type === "clinic" ? form.clinic_id : form.distributor_id;
    if (!email || !scopeId) {
      toast({ title: "Email and organisation are required", variant: "destructive" });
      return;
    }

    const { data: existing } = await supabase.from("portal_users").select("id").eq("email", email).maybeSingle();
    let portalUserId = existing?.id;

    if (!portalUserId) {
      const { data: inserted, error } = await supabase
        .from("portal_users")
        .insert({ email, full_name: form.full_name.trim() || null, is_active: true })
        .select("id")
        .single();
      if (error) {
        toast({ title: "Could not create portal user", description: error.message, variant: "destructive" });
        return;
      }
      portalUserId = inserted.id;
    }

    const { error: memErr } = await supabase.from("portal_memberships").insert({
      portal_user_id: portalUserId,
      org_type: form.org_type as "clinic" | "distributor",
      clinic_id: form.org_type === "clinic" ? form.clinic_id : null,
      distributor_id: form.org_type === "distributor" ? form.distributor_id : null,
      role: form.role as (typeof CLINIC_ROLES)[number] | (typeof DISTRIBUTOR_ROLES)[number],
      is_active: true,
    });
    if (memErr) {
      toast({ title: "Could not grant access", description: memErr.message, variant: "destructive" });
      return;
    }

    toast({
      title: "Portal access granted",
      description: `${email} can sign in at /portal/login with a magic link.`,
    });
    setOpen(false);
    setForm({ email: "", full_name: "", org_type: "clinic", clinic_id: "", distributor_id: "", role: "clinic_admin" });
    qc.invalidateQueries({ queryKey: ["portal-users"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("portal_users").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not delete", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["portal-users"] });
  };

  const roles = form.org_type === "clinic" ? CLINIC_ROLES : DISTRIBUTOR_ROLES;

  return (
    <SectionCard
      title="Portal users"
      description="Clinic and distributor contacts who can sign in at /portal/login and manage their own consultations."
      action={<Button size="sm" className="gap-2" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Grant access</Button>}
    >
      {isLoading ? <Spinner /> : (
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
                  {(u.portal_memberships ?? [])
                    .map((m: { role: string; clinic: { name: string } | null; distributor: { name: string } | null }) =>
                      `${m.clinic?.name ?? m.distributor?.name ?? "—"} (${m.role.replace(/_/g, " ")})`)
                    .join(", ") || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={u.accepted_at ? "default" : "secondary"}>{u.accepted_at ? "Active" : "Invited"}</Badge>
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
          <DialogHeader><DialogTitle>Grant portal access</DialogTitle></DialogHeader>
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
                  onValueChange={(v) => setForm({ ...form, org_type: v, role: v === "clinic" ? "clinic_admin" : "distributor_admin" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clinic">Clinic</SelectItem>
                    <SelectItem value="distributor">Distributor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{form.org_type === "clinic" ? "Clinic" : "Distributor"}</Label>
              {form.org_type === "clinic" ? (
                <Select value={form.clinic_id} onValueChange={(v) => setForm({ ...form, clinic_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select a clinic" /></SelectTrigger>
                  <SelectContent>
                    {(clinics ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={form.distributor_id} onValueChange={(v) => setForm({ ...form, distributor_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select a distributor" /></SelectTrigger>
                  <SelectContent>
                    {(distributors ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Grant access</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
