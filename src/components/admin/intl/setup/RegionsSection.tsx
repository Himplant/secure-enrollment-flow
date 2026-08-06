import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionCard, EmptyRow, Spinner, COUNTRIES, countryLabel } from "./shared";

type Country = (typeof COUNTRIES)[number];

export function RegionsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ country: Country; name: string; code: string; distributor_id: string }>({
    country: "CO", name: "", code: "", distributor_id: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["intl-regions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("regions")
        .select("id, country, name, code, is_active, distributor_regions(distributor:distributors(name))")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: distributors } = useQuery({
    queryKey: ["intl-distributors-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("distributors").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast({ title: "Name and code are required", variant: "destructive" });
      return;
    }
    const { data: inserted, error } = await supabase
      .from("regions")
      .insert({ country: form.country, name: form.name.trim(), code: form.code.trim().toUpperCase(), is_active: true })
      .select("id")
      .single();
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    if (form.distributor_id) {
      await supabase.from("distributor_regions").insert({ distributor_id: form.distributor_id, region_id: inserted.id });
    }
    toast({ title: "Region added" });
    setOpen(false);
    setForm({ country: "CO", name: "", code: "", distributor_id: "" });
    qc.invalidateQueries({ queryKey: ["intl-regions"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("regions").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not delete", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["intl-regions"] });
  };

  return (
    <SectionCard
      title="Regions"
      description="Territories inside a country. Clinics belong to a region; distributors cover regions."
      action={<Button size="sm" className="gap-2" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add region</Button>}
    >
      {isLoading ? <Spinner /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Region</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Distributors</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <EmptyRow colSpan={5} text="No regions yet." />}
            {(data ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-muted-foreground">{r.code}</TableCell>
                <TableCell>{countryLabel(r.country)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {(r.distributor_regions ?? []).map((dr: { distributor: { name: string } | null }) => dr.distributor?.name).filter(Boolean).join(", ") || "—"}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
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
          <DialogHeader><DialogTitle>Add region</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Country</Label>
              <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v as Country })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{countryLabel(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bogotá metro" />
            </div>
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="CO-BOG" />
            </div>
            <div className="space-y-1.5">
              <Label>Distributor (optional)</Label>
              <Select value={form.distributor_id} onValueChange={(v) => setForm({ ...form, distributor_id: v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {(distributors ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
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
