import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionCard, EmptyRow, Spinner, countryLabel } from "./shared";
import { formatIntlMoney, toMinor } from "@/lib/intlMoney";

export function ClinicSurgeonsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [clinicId, setClinicId] = useState("");
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [surgeonId, setSurgeonId] = useState("");
  const [fee, setFee] = useState("");

  const { data: clinics } = useQuery({
    queryKey: ["intl-clinics-setup-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name, country, default_currency")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const clinic = (clinics ?? []).find((c) => c.id === clinicId);
  const currency = clinic?.default_currency ?? "USD";

  const { data: links, isLoading } = useQuery({
    queryKey: ["intl-clinic-surgeons-setup", clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinic_surgeons")
        .select("id, consultation_fee_minor, currency, is_active, surgeon:surgeons(id, name, country, city)")
        .eq("clinic_id", clinicId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: surgeons } = useQuery({
    queryKey: ["intl-surgeons-pick", clinic?.country, showAll],
    enabled: open && !!clinic,
    queryFn: async () => {
      let q = supabase.from("surgeons").select("id, name, country, city, is_international").eq("is_active", true).order("name");
      if (!showAll) q = q.eq("country", clinic!.country);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    if (!clinicId || !surgeonId || !fee) {
      toast({ title: "Pick a surgeon and set a fee", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("clinic_surgeons").insert({
      clinic_id: clinicId,
      surgeon_id: surgeonId,
      consultation_fee_minor: toMinor(Number(fee), currency),
      currency,
      is_active: true,
    });
    if (error) {
      toast({ title: "Could not link surgeon", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Surgeon linked to clinic" });
    setOpen(false);
    setSurgeonId("");
    setFee("");
    qc.invalidateQueries({ queryKey: ["intl-clinic-surgeons-setup", clinicId] });
    qc.invalidateQueries({ queryKey: ["intl-clinic-surgeons"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("clinic_surgeons").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not remove", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["intl-clinic-surgeons-setup", clinicId] });
  };

  return (
    <SectionCard
      title="Clinic surgeons"
      description="Attach surgeons to a clinic and set their consultation fee. The picker defaults to surgeons whose CRM country matches the clinic."
      action={
        <Button size="sm" className="gap-2" disabled={!clinicId} onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Attach surgeon
        </Button>
      }
    >
      <div className="mb-4 max-w-xs">
        <Label className="mb-1.5 block">Clinic</Label>
        <Select value={clinicId} onValueChange={setClinicId}>
          <SelectTrigger><SelectValue placeholder="Select a clinic" /></SelectTrigger>
          <SelectContent>
            {(clinics ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name} · {countryLabel(c.country)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!clinicId ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Select a clinic to manage its surgeons.</p>
      ) : isLoading ? <Spinner /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Surgeon</TableHead>
              <TableHead>CRM country</TableHead>
              <TableHead>Consultation fee</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(links ?? []).length === 0 && <EmptyRow colSpan={4} text="No surgeons attached to this clinic yet." />}
            {(links ?? []).map((l) => {
              const s = l.surgeon as { name: string; country: string | null; city: string | null } | null;
              return (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{s?.name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{countryLabel(s?.country)}{s?.city ? ` · ${s.city}` : ""}</TableCell>
                  <TableCell>{formatIntlMoney(l.consultation_fee_minor, l.currency)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => remove(l.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Attach surgeon to {clinic?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-normal">Show surgeons from all countries</Label>
              <Switch checked={showAll} onCheckedChange={setShowAll} />
            </div>
            <div className="space-y-1.5">
              <Label>Surgeon</Label>
              <Select value={surgeonId} onValueChange={setSurgeonId}>
                <SelectTrigger><SelectValue placeholder="Select a surgeon" /></SelectTrigger>
                <SelectContent>
                  {(surgeons ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{s.country ? ` · ${s.country}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(surgeons ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No surgeons match this clinic's country. Run "Sync from Zoho" on the Surgeons tab, or toggle the switch above.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Consultation fee ({currency})</Label>
              <Input type="number" value={fee} onChange={(e) => setFee(e.target.value)} />
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
