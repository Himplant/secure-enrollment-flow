import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionCard, EmptyRow, Spinner } from "./shared";
import { DistributorSurgeonsDialog } from "./DistributorSurgeonsDialog";

export function DistributorsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({ name: "", legal_name: "", primary_contact_email: "", primary_contact_phone: "", is_active: true });

  const { data, isLoading } = useQuery({
    queryKey: ["intl-distributors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, name, legal_name, primary_contact_email, is_active")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("distributors").insert({
      name: form.name.trim(),
      legal_name: form.legal_name.trim() || null,
      primary_contact_email: form.primary_contact_email.trim() || null,
      primary_contact_phone: form.primary_contact_phone.trim() || null,
      is_active: form.is_active,
    });
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Distributor added" });
    setOpen(false);
    setForm({ name: "", legal_name: "", primary_contact_email: "", primary_contact_phone: "", is_active: true });
    qc.invalidateQueries({ queryKey: ["intl-distributors"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("distributors").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not delete", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["intl-distributors"] });
  };

  return (
    <SectionCard
      title="Distributors"
      description="Partner organisations that oversee a group of international surgeons."
      action={
        <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add distributor
        </Button>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Legal name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <EmptyRow colSpan={5} text="No distributors yet." />}
            {(data ?? []).map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell className="text-muted-foreground">{d.legal_name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{d.primary_contact_email ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={d.is_active ? "default" : "secondary"}>{d.is_active ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" title="Assign surgeons" onClick={() => setAssigning({ id: d.id, name: d.name })}>
                    <Users className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(d.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <DistributorSurgeonsDialog distributor={assigning} onClose={() => setAssigning(null)} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add distributor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Legal name</Label>
              <Input value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Contact email</Label>
              <Input type="email" value={form.primary_contact_email} onChange={(e) => setForm({ ...form, primary_contact_email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Contact phone</Label>
              <Input value={form.primary_contact_phone} onChange={(e) => setForm({ ...form, primary_contact_phone: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
