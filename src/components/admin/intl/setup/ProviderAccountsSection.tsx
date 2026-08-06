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
import { SectionCard, EmptyRow, Spinner, countryLabel, CURRENCY_BY_COUNTRY } from "./shared";

const PROVIDERS = [
  { value: "test", label: "Simulated test provider" },
  { value: "mercado_pago", label: "Mercado Pago" },
  { value: "paypal", label: "PayPal" },
] as const;

export function ProviderAccountsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ surgeon_id: "", provider: "test", external_merchant_id: "" });

  const { data: surgeons } = useQuery({
    queryKey: ["intl-surgeons-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surgeons")
        .select("id, name, country, currency")
        .eq("is_international", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["intl-provider-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_accounts")
        .select(
          "id, provider, country, currency, status, environment, external_merchant_id, is_active, surgeon:surgeons(name)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    const surgeon = (surgeons ?? []).find((s) => s.id === form.surgeon_id);
    if (!surgeon || !surgeon.country) {
      toast({ title: "Pick a surgeon with a country set", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("provider_accounts").insert({
      surgeon_id: surgeon.id,
      provider: form.provider as "test" | "mercado_pago" | "paypal",
      country: surgeon.country as "MX" | "CO" | "CL",
      currency: surgeon.currency ?? CURRENCY_BY_COUNTRY[surgeon.country],
      external_merchant_id: form.external_merchant_id.trim() || null,
      status: form.provider === "test" ? "connected" : "pending",
      connection_method: "admin_managed",
      environment: form.provider === "test" ? "sandbox" : "live",
      is_active: true,
      connected_at: form.provider === "test" ? new Date().toISOString() : null,
    });
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Payment account added" });
    setOpen(false);
    setForm({ surgeon_id: "", provider: "test", external_merchant_id: "" });
    qc.invalidateQueries({ queryKey: ["intl-provider-accounts"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("provider_accounts").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not delete", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["intl-provider-accounts"] });
  };

  return (
    <SectionCard
      title="Payment accounts"
      description="Where a surgeon's consultation fees settle. The simulated test provider works today; Mercado Pago and PayPal are placeholders until those integrations are connected."
      action={
        <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add account
        </Button>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Surgeon</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <EmptyRow colSpan={6} text="No payment accounts yet." />}
            {(data ?? []).map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">
                  {(a.surgeon as { name: string } | null)?.name ?? "—"}
                </TableCell>
                <TableCell>{PROVIDERS.find((p) => p.value === a.provider)?.label ?? a.provider}</TableCell>
                <TableCell>{countryLabel(a.country)}</TableCell>
                <TableCell>{a.currency}</TableCell>
                <TableCell>
                  <Badge variant={a.status === "connected" ? "default" : "secondary"}>{a.status}</Badge>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => remove(a.id)}>
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
            <DialogTitle>Add payment account</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Surgeon</Label>
              <Select value={form.surgeon_id} onValueChange={(v) => setForm({ ...form, surgeon_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a surgeon" />
                </SelectTrigger>
                <SelectContent>
                  {(surgeons ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} — {countryLabel(s.country)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Merchant / account ID (optional)</Label>
              <Input
                value={form.external_merchant_id}
                onChange={(e) => setForm({ ...form, external_merchant_id: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
