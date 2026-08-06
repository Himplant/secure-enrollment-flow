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
import {
  SectionCard, EmptyRow, Spinner, COUNTRIES, countryLabel, CURRENCY_BY_COUNTRY, TZ_BY_COUNTRY,
} from "./shared";

type Country = (typeof COUNTRIES)[number];

export function ClinicsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    name: string; country: Country; region_id: string; city: string;
    contact_email: string; contact_phone: string; distributor_id: string;
  }>({ name: "", country: "CO", region_id: "", city: "", contact_email: "", contact_phone: "", distributor_id: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["intl-clinics-setup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name, country, city, default_currency, is_active, contact_email, region:regions(name)")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: regions } = useQuery({
    queryKey: ["intl-regions-min", form.country],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("regions").select("id, name").eq("country", form.country).order("name");
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
    if (!form.name.trim()) {
      toast({ title: "Clinic name is required", variant: "destructive" });
      return;
    }
    const { data: inserted, error } = await supabase
      .from("clinics")
      .insert({
        name: form.name.trim(),
        country: form.country,
        region_id: form.region_id || null,
        city: form.city.trim() || null,
        timezone: TZ_BY_COUNTRY[form.country],
        default_currency: CURRENCY_BY_COUNTRY[form.country],
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        is_active: true,
      })
      .select("id")
      .single();
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    if (form.distributor_id) {
      await supabase.from("clinic_distributors").insert({
        clinic_id: inserted.id, distributor_id: form.distributor_id, is_primary: true,
      });
    }
    toast({ title: "Clinic added" });
    setOpen(false);
    setForm({ name: "", country: "CO", region_id: "", city: "", contact_email: "", contact_phone: "", distributor_id: "" });
    qc.invalidateQueries({ queryKey: ["intl-clinics-setup"] });
    qc.invalidateQueries({ queryKey: ["intl-clinics-active"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("clinics").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not delete", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["intl-clinics-setup"] });
  };

  return (
    <SectionCard
      title="Clinics"
      description="Where consultations happen. Currency and timezone follow the country."
      action={<Button size="sm" className="gap-2" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add clinic</Button>}
    >
      {isLoading ? <Spinner /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Clinic</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <EmptyRow colSpan={7} text="No clinics yet." />}
            {(data ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{countryLabel(c.country)}</TableCell>
                <TableCell className="text-muted-foreground">{(c.region as { name: string } | null)?.name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.city ?? "—"}</TableCell>
                <TableCell>{c.default_currency}</TableCell>
                <TableCell><Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => remove(c.id)}>
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
          <DialogHeader><DialogTitle>Add clinic</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v as Country, region_id: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{countryLabel(c)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Region</Label>
                <Select value={form.region_id} onValueChange={(v) => setForm({ ...form, region_id: v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    {(regions ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Contact email</Label>
                <Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Contact phone</Label>
                <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
              </div>
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
            <p className="text-xs text-muted-foreground">
              Currency {CURRENCY_BY_COUNTRY[form.country]} and timezone {TZ_BY_COUNTRY[form.country]} are set automatically.
            </p>
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
