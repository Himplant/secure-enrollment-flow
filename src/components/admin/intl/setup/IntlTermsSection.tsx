import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionCard, EmptyRow, Spinner, COUNTRIES, countryLabel } from "./shared";

type Country = (typeof COUNTRIES)[number];

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function IntlTermsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ country: Country; language: string; version: string; terms_text: string }>({
    country: "CO", language: "es", version: "1.0", terms_text: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["intl-terms"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("international_policies")
        .select("id, country, language, version, is_active, effective_at")
        .order("effective_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    if (!form.terms_text.trim()) {
      toast({ title: "Terms text is required", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("international_policies").insert({
      country: form.country,
      language: form.language,
      version: form.version.trim() || "1.0",
      terms_text: form.terms_text.trim(),
      content_sha256: await sha256Hex(form.terms_text.trim()),
      effective_at: new Date().toISOString(),
      is_active: true,
    });
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Terms published" });
    setOpen(false);
    setForm({ country: "CO", language: "es", version: "1.0", terms_text: "" });
    qc.invalidateQueries({ queryKey: ["intl-terms"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("international_policies").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not delete", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["intl-terms"] });
  };

  return (
    <SectionCard
      title="Consultation terms"
      description="Shown on the patient payment page and hashed into the consent record."
      action={<Button size="sm" className="gap-2" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add terms</Button>}
    >
      {isLoading ? <Spinner /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Country</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <EmptyRow colSpan={5} text="No terms published yet." />}
            {(data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{countryLabel(p.country)}</TableCell>
                <TableCell className="uppercase text-muted-foreground">{p.language}</TableCell>
                <TableCell>{p.version}</TableCell>
                <TableCell><Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => remove(p.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Add consultation terms</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
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
                <Label>Language</Label>
                <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="es">Spanish</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Version</Label>
                <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Terms text</Label>
              <Textarea rows={10} value={form.terms_text} onChange={(e) => setForm({ ...form, terms_text: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Publish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
