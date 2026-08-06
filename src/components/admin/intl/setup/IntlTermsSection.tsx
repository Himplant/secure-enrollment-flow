import { useMemo, useState } from "react";
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
import { Archive, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionCard, EmptyRow, Spinner, COUNTRIES, countryLabel } from "./shared";

type Country = (typeof COUNTRIES)[number];

const ANY = "any";
const PROVIDERS = ["mercado_pago", "paypal", "test"] as const;
const LANGUAGES = ["es", "en", "pt"] as const;

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface PolicyRow {
  id: string;
  country: string;
  language: string;
  provider: string | null;
  surgeon_id: string | null;
  is_country_default: boolean;
  version: string;
  is_active: boolean;
  retired_at: string | null;
  effective_at: string;
  surgeon?: { name: string } | null;
}

/**
 * Mirrors the server-side resolution order in _shared/intl-policy.ts:
 * surgeon+provider > surgeon > country-default+provider > country-default.
 */
function precedenceRank(p: PolicyRow) {
  if (p.surgeon_id && p.provider) return 1;
  if (p.surgeon_id) return 2;
  if (p.provider) return 3;
  return 4;
}

export function IntlTermsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    country: "CO" as Country,
    language: "es",
    provider: ANY,
    surgeon_id: ANY,
    version: "1.0",
    terms_text: "",
    cancellation_policy: "",
    no_show_policy: "",
    refund_exceptions: "",
    privacy_url: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["intl-terms"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("international_policies")
        .select(
          "id, country, language, provider, surgeon_id, is_country_default, version, is_active, retired_at, effective_at, surgeon:surgeons(name)",
        )
        .order("effective_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PolicyRow[];
    },
  });

  const { data: surgeons } = useQuery({
    queryKey: ["intl-surgeons-for-policy"],
    queryFn: async () => {
      const { data } = await supabase
        .from("surgeons")
        .select("id, name, country")
        .eq("is_international", true)
        .eq("is_active", true)
        .order("name");
      return data ?? [];
    },
  });

  // Which active policy currently wins for each country + language scope.
  const winners = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of data ?? []) {
      if (!p.is_active || p.retired_at) continue;
      const key = `${p.country}|${p.language}|${p.provider ?? ANY}|${p.surgeon_id ?? ANY}`;
      const current = (data ?? []).find((x) => x.id === map.get(key));
      if (!current || precedenceRank(p) < precedenceRank(current)) map.set(key, p.id);
    }
    return new Set(map.values());
  }, [data]);

  const save = async () => {
    if (!form.terms_text.trim()) {
      toast({ title: "Terms text is required", variant: "destructive" });
      return;
    }
    const surgeonId = form.surgeon_id === ANY ? null : form.surgeon_id;
    const { error } = await supabase.from("international_policies").insert({
      country: form.country,
      language: form.language,
      provider: form.provider === ANY ? null : (form.provider as PolicyRow["provider"]),
      surgeon_id: surgeonId,
      is_country_default: !surgeonId,
      version: form.version.trim() || "1.0",
      terms_text: form.terms_text.trim(),
      cancellation_policy: form.cancellation_policy.trim() || null,
      no_show_policy: form.no_show_policy.trim() || null,
      refund_exceptions: form.refund_exceptions.trim() || null,
      privacy_url: form.privacy_url.trim() || null,
      content_sha256: await sha256Hex(form.terms_text.trim()),
      effective_at: new Date().toISOString(),
      is_active: true,
    } as never);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Policy published", description: "Published versions are immutable." });
    setOpen(false);
    setForm({
      country: "CO", language: "es", provider: ANY, surgeon_id: ANY, version: "1.0",
      terms_text: "", cancellation_policy: "", no_show_policy: "", refund_exceptions: "", privacy_url: "",
    });
    qc.invalidateQueries({ queryKey: ["intl-terms"] });
  };

  // Published policies are never hard-deleted — consultations reference them.
  const retire = async (id: string) => {
    if (!window.confirm("Retire this policy? Existing consultations keep their snapshot; new links stop using it.")) return;
    const { error } = await supabase
      .from("international_policies")
      .update({ is_active: false, retired_at: new Date().toISOString() } as never)
      .eq("id", id);
    if (error) {
      toast({ title: "Could not retire", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Policy retired" });
    qc.invalidateQueries({ queryKey: ["intl-terms"] });
  };

  return (
    <SectionCard
      title="Consultation terms"
      description="Country defaults plus optional surgeon overrides. The most specific active policy wins; links are rejected when none exists."
      action={
        <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add policy
        </Button>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scope</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <EmptyRow colSpan={7} text="No policies published yet." />}
            {(data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">
                  {p.surgeon_id ? `Surgeon: ${p.surgeon?.name ?? "—"}` : "Country default"}
                  {winners.has(p.id) && (
                    <Badge variant="outline" className="ml-2">Winning</Badge>
                  )}
                </TableCell>
                <TableCell>{countryLabel(p.country)}</TableCell>
                <TableCell className="uppercase text-muted-foreground">{p.language}</TableCell>
                <TableCell className="capitalize text-muted-foreground">
                  {p.provider ? p.provider.replace(/_/g, " ") : "Any"}
                </TableCell>
                <TableCell>{p.version}</TableCell>
                <TableCell>
                  <Badge variant={p.is_active && !p.retired_at ? "default" : "secondary"}>
                    {p.is_active && !p.retired_at ? "Active" : "Retired"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {p.is_active && !p.retired_at && (
                    <Button variant="ghost" size="icon" title="Retire policy" onClick={() => retire(p.id)}>
                      <Archive className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Publish consultation policy</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v as Country })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c} value={c}>{countryLabel(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Surgeon override</Label>
                <Select value={form.surgeon_id} onValueChange={(v) => setForm({ ...form, surgeon_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>None — country default</SelectItem>
                    {(surgeons ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any provider</SelectItem>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">{p.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Version</Label>
                <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Privacy URL</Label>
                <Input value={form.privacy_url} onChange={(e) => setForm({ ...form, privacy_url: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Terms text</Label>
              <Textarea rows={8} value={form.terms_text} onChange={(e) => setForm({ ...form, terms_text: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Cancellation policy</Label>
              <Textarea rows={2} value={form.cancellation_policy} onChange={(e) => setForm({ ...form, cancellation_policy: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>No-show policy</Label>
              <Textarea rows={2} value={form.no_show_policy} onChange={(e) => setForm({ ...form, no_show_policy: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Refund exceptions</Label>
              <Textarea rows={2} value={form.refund_exceptions} onChange={(e) => setForm({ ...form, refund_exceptions: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">
              Published versions are immutable and can only be retired, never deleted.
            </p>
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
