import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pencil, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatIntlMoney, toMinor, fromMinor } from "@/lib/intlMoney";
import { SectionCard, EmptyRow, Spinner, countryLabel, COUNTRIES, CURRENCY_BY_COUNTRY, TZ_BY_COUNTRY } from "./shared";

const PROVIDERS = [
  { value: "test", label: "Simulated test provider" },
  { value: "mercado_pago", label: "Mercado Pago" },
  { value: "paypal", label: "PayPal" },
  { value: "stripe_connect", label: "Stripe Connect" },
] as const;

interface SurgeonRow {
  id: string;
  name: string;
  email: string | null;
  country: string | null;
  city: string | null;
  is_international: boolean;
  is_active: boolean;
  consultation_fee_minor: number | null;
  currency: string | null;
  timezone: string | null;
  active_provider: string | null;
}

export function IntlSurgeonsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<SurgeonRow | null>(null);
  const [form, setForm] = useState({
    country: "",
    city: "",
    fee: "",
    currency: "",
    timezone: "",
    active_provider: "test",
    is_international: true,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["intl-surgeons-setup", showAll],
    queryFn: async () => {
      let q = supabase
        .from("surgeons")
        .select(
          "id, name, email, country, city, is_international, is_active, consultation_fee_minor, currency, timezone, active_provider",
        )
        .order("name");
      if (!showAll) q = q.eq("is_international", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SurgeonRow[];
    },
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter((s) =>
      !term ? true : [s.name, s.email, s.city, s.country].some((v) => String(v ?? "").toLowerCase().includes(term)),
    );
  }, [data, search]);

  const openEdit = (s: SurgeonRow) => {
    setEditing(s);
    setForm({
      country: s.country ?? "",
      city: s.city ?? "",
      fee: s.consultation_fee_minor != null && s.currency ? String(fromMinor(s.consultation_fee_minor, s.currency)) : "",
      currency: s.currency ?? (s.country ? CURRENCY_BY_COUNTRY[s.country] ?? "" : ""),
      timezone: s.timezone ?? (s.country ? TZ_BY_COUNTRY[s.country] ?? "" : ""),
      active_provider: s.active_provider ?? "test",
      is_international: s.is_international,
    });
  };

  const save = async () => {
    if (!editing) return;
    const currency = form.currency || (form.country ? CURRENCY_BY_COUNTRY[form.country] : null);
    if (form.is_international && (!form.country || !currency)) {
      toast({ title: "Country and currency are required", variant: "destructive" });
      return;
    }
    const { error } = await supabase
      .from("surgeons")
      .update({
        country: form.country || null,
        city: form.city.trim() || null,
        is_international: form.is_international,
        currency,
        timezone: form.timezone || (form.country ? TZ_BY_COUNTRY[form.country] ?? null : null),
        active_provider: form.active_provider as "test" | "mercado_pago" | "paypal" | "stripe_connect",
        consultation_fee_minor: form.fee && currency ? toMinor(Number(form.fee), currency) : null,
      })
      .eq("id", editing.id);

    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Surgeon updated" });
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["intl-surgeons-setup"] });
  };

  return (
    <SectionCard
      title="International surgeons"
      description="Surgeons synced from the CRM. The country comes from the CRM address; set the consultation fee and payment provider here so a link can be created."
      action={
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Show all surgeons</Label>
          <Switch checked={showAll} onCheckedChange={setShowAll} />
        </div>
      }
    >
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search surgeon, city or country"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Surgeon</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Consultation fee</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <EmptyRow colSpan={7} text="No surgeons match." />}
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.email ?? ""}</div>
                  </TableCell>
                  <TableCell>{countryLabel(s.country)}</TableCell>
                  <TableCell className="text-muted-foreground">{s.city ?? "—"}</TableCell>
                  <TableCell>
                    {s.consultation_fee_minor != null && s.currency
                      ? formatIntlMoney(s.consultation_fee_minor, s.currency)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {PROVIDERS.find((p) => p.value === s.active_provider)?.label ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.is_international ? "default" : "secondary"}>
                      {s.is_international ? "International" : "Domestic"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>International surgeon</Label>
              <Switch
                checked={form.is_international}
                onCheckedChange={(v) => setForm({ ...form, is_international: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Select
                  value={form.country}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      country: v,
                      currency: CURRENCY_BY_COUNTRY[v] ?? form.currency,
                      timezone: TZ_BY_COUNTRY[v] ?? form.timezone,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {countryLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Consultation fee ({form.currency || "—"})</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.fee}
                  onChange={(e) => setForm({ ...form, fee: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Payment provider</Label>
                <Select value={form.active_provider} onValueChange={(v) => setForm({ ...form, active_provider: v })}>
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
            </div>
            <p className="text-xs text-muted-foreground">
              The surgeon also needs a connected payment account under <strong>Payment accounts</strong> before a link
              can be created.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
