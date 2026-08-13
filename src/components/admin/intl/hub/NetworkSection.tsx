import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Plus, RefreshCw, Search, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionCard, EmptyRow, Spinner, countryLabel, COUNTRIES } from "../setup/shared";
import { useAssignDistributor, useIntlNetwork, useSaveDistributor, type DistributorInput } from "./useIntlNetwork";
import {
  computeSurgeonReadiness,
  paymentState,
  portalAccessState,
  sortDistributorsForCountry,
  type NetworkDistributor,
} from "@/lib/intlNetwork";

const UNASSIGNED = "__none__";

const PROVIDER_LABEL: Record<string, string> = {
  test: "Simulated test provider",
  mercado_pago: "Mercado Pago",
  paypal: "PayPal",
  stripe_connect: "Stripe Connect",
};

interface Props {
  onSync: () => void;
  syncing: boolean;
  canManage: boolean;
  onInvite: (target: {
    orgType: "surgeon" | "distributor";
    orgId: string;
    email?: string | null;
    fullName?: string | null;
  }) => void;
}

const emptyDistributor: DistributorInput = {
  name: "",
  legal_name: "",
  countries: [],
  primary_contact_email: "",
  primary_contact_phone: "",
  is_active: true,
};

export function NetworkSection({ onSync, syncing, canManage, onInvite }: Props) {
  const { toast } = useToast();
  const { data, isLoading } = useIntlNetwork();
  const assign = useAssignDistributor();
  const saveDistributor = useSaveDistributor();

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<DistributorInput | null>(null);
  const [inviteContact, setInviteContact] = useState(true);

  const distributorBySurgeon = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of data?.assignments ?? []) map[a.surgeon_id] = a.distributor_id;
    return map;
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    const settings = Object.fromEntries(data.country_settings.map((c) => [c.country, c]));
    return data.surgeons
      .filter((s) =>
        !term ? true : [s.name, s.email, s.city, s.country].some((v) => String(v ?? "").toLowerCase().includes(term)),
      )
      .map((s) => {
        const setting = settings[s.country ?? ""] ?? null;
        const memberships = data.memberships.filter((m) => m.surgeon_id === s.id);
        const access = portalAccessState(memberships);
        const payment = paymentState(
          data.provider_accounts.filter((a) => a.surgeon_id === s.id),
          setting?.allowed_providers ?? [],
        );
        const hasPolicy = data.policies.some(
          (p) => p.country === s.country && (p.surgeon_id === null || p.surgeon_id === s.id),
        );
        const distributorId = distributorBySurgeon[s.id] ?? null;
        return {
          surgeon: s,
          distributorId,
          access,
          payment,
          readiness: computeSurgeonReadiness({
            surgeon: s,
            distributorId,
            countrySetting: setting,
            hasPolicy,
            payment,
            access,
          }),
        };
      });
  }, [data, search, distributorBySurgeon]);

  const changeDistributor = async (surgeonId: string, value: string) => {
    try {
      await assign.mutateAsync({
        surgeon_id: surgeonId,
        distributor_id: value === UNASSIGNED ? null : value,
      });
      toast({
        title: value === UNASSIGNED ? "Distributor removed" : "Distributor assigned",
        description:
          value === UNASSIGNED
            ? "This surgeon is no longer visible to any distributor."
            : "Any previous distributor was replaced — a surgeon has one distributor.",
      });
    } catch (e) {
      toast({
        title: "Could not update",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const submitDistributor = async () => {
    if (!editing) return;
    try {
      const res = await saveDistributor.mutateAsync(editing);
      toast({ title: editing.id ? "Distributor updated" : "Distributor added" });
      const newId = res.id;
      const email = (editing.primary_contact_email ?? "").trim();
      const shouldInvite = !editing.id && inviteContact && email && newId;
      const inviteName = (editing.legal_name ?? "").trim() || (editing.name ?? "").trim();
      setEditing(null);
      if (shouldInvite) {
        onInvite({ orgType: "distributor", orgId: newId!, email, fullName: inviteName || null });
      }
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const distributorCounts = useMemo(() => {
    const surgeons: Record<string, number> = {};
    const users: Record<string, number> = {};
    for (const a of data?.assignments ?? []) surgeons[a.distributor_id] = (surgeons[a.distributor_id] ?? 0) + 1;
    for (const m of data?.memberships ?? []) {
      if (m.distributor_id) users[m.distributor_id] = (users[m.distributor_id] ?? 0) + 1;
    }
    return { surgeons, users };
  }, [data]);

  const accessBadge = (state: string) =>
    state === "active" ? (
      <Badge>Active</Badge>
    ) : state === "invited" ? (
      <Badge variant="secondary">Invited</Badge>
    ) : (
      <Badge variant="outline">None</Badge>
    );

  return (
    <div className="space-y-4">
      <SectionCard
        title="Surgeons from Zoho"
        description="Names and country are synced from Zoho CRM. Assign a distributor and portal access here."
        action={
          <Button size="sm" onClick={onSync} disabled={syncing} className="gap-2">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync from Zoho
          </Button>
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
          <TooltipProvider>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Surgeon</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead className="min-w-[220px]">Distributor</TableHead>
                    <TableHead>Portal access</TableHead>
                    <TableHead>Payment account</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <EmptyRow colSpan={6} text="No international surgeons yet — sync from Zoho to load them." />
                  )}
                  {rows.map((r) => {
                    const options = sortDistributorsForCountry(
                      (data?.distributors ?? []).filter((d) => d.is_active),
                      r.surgeon.country,
                    );
                    return (
                      <TableRow key={r.surgeon.id}>
                        <TableCell>
                          <div className="font-medium">{r.surgeon.name}</div>
                          <div className="text-xs text-muted-foreground">{r.surgeon.email ?? ""}</div>
                        </TableCell>
                        <TableCell>
                          {r.surgeon.country ? (
                            <div className="space-y-1">
                              <Badge variant="secondary">{countryLabel(r.surgeon.country)}</Badge>
                              <p className="text-[11px] text-muted-foreground">From Zoho</p>
                            </div>
                          ) : (
                            <Badge variant="destructive">Needs CRM country</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={r.distributorId ?? UNASSIGNED}
                            disabled={!canManage || assign.isPending}
                            onValueChange={(v) => changeDistributor(r.surgeon.id, v)}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Choose a distributor" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                              {options.map((d) => (
                                <SelectItem key={d.id} value={d.id}>
                                  {d.name}
                                  {r.surgeon.country && (d.countries ?? []).includes(r.surgeon.country)
                                    ? ""
                                    : " (other country)"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {!r.distributorId && (
                            <p className="mt-1 text-[11px] text-amber-600">Not assigned yet</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {accessBadge(r.access)}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() =>
                                onInvite({
                                  orgType: "surgeon",
                                  orgId: r.surgeon.id,
                                  email: r.surgeon.email ?? null,
                                  fullName: r.surgeon.name ?? null,
                                })
                              }
                            >
                              <UserPlus className="mr-1 h-3.5 w-3.5" />
                              {r.access === "none" ? "Invite" : "Manage"}
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{r.payment.label}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {r.payment.provider ? PROVIDER_LABEL[r.payment.provider] ?? r.payment.provider : "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant={
                                  r.readiness.tone === "ready"
                                    ? "default"
                                    : r.readiness.tone === "blocked"
                                      ? "destructive"
                                      : "secondary"
                                }
                              >
                                {r.readiness.label}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>{r.readiness.hint}</TooltipContent>
                          </Tooltip>
                          <p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground">{r.readiness.hint}</p>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}
      </SectionCard>

      <SectionCard
        title="Distributors"
        description="Partner organisations that oversee a group of surgeons in the countries they serve."
        action={
          canManage ? (
            <Button
              size="sm"
              className="gap-2"
              onClick={() => {
                setInviteContact(true);
                setEditing({ ...emptyDistributor });
              }}
            >
              <Plus className="h-4 w-4" /> Add distributor
            </Button>
          ) : undefined
        }
      >
        {isLoading ? (
          <Spinner />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Distributor</TableHead>
                <TableHead>Countries served</TableHead>
                <TableHead>Surgeons</TableHead>
                <TableHead>Portal users</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.distributors ?? []).length === 0 && <EmptyRow colSpan={6} text="No distributors yet." />}
              {(data?.distributors ?? []).map((d: NetworkDistributor) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.primary_contact_email ?? "—"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(d.countries ?? []).length === 0 ? (
                        <Badge variant="destructive">None set</Badge>
                      ) : (
                        (d.countries ?? []).map((c) => (
                          <Badge key={c} variant="secondary">
                            {countryLabel(c)}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{distributorCounts.surgeons[d.id] ?? 0}</TableCell>
                  <TableCell>{distributorCounts.users[d.id] ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={d.is_active ? "default" : "secondary"}>
                      {d.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setInviteContact(false);
                          setEditing({
                            id: d.id,
                            name: d.name,
                            legal_name: d.legal_name ?? "",
                            countries: d.countries ?? [],
                            primary_contact_email: d.primary_contact_email ?? "",
                            primary_contact_phone: d.primary_contact_phone ?? "",
                            is_active: d.is_active,
                          });
                        }}
                      >
                        Edit
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onInvite({
                          orgType: "distributor",
                          orgId: d.id,
                          email: d.primary_contact_email ?? null,
                          fullName: (d.legal_name ?? d.name) || null,
                        })
                      }
                    >
                      Invite admin
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit distributor" : "Add distributor"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Legal name (optional)</Label>
                <Input
                  value={editing.legal_name ?? ""}
                  onChange={(e) => setEditing({ ...editing, legal_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Countries served</Label>
                <div className="flex flex-wrap gap-3">
                  {COUNTRIES.map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={editing.countries.includes(c)}
                        onCheckedChange={(v) =>
                          setEditing({
                            ...editing,
                            countries:
                              v === true
                                ? [...editing.countries, c]
                                : editing.countries.filter((x) => x !== c),
                          })
                        }
                      />
                      {countryLabel(c)}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Contact email (optional)</Label>
                  <Input
                    type="email"
                    value={editing.primary_contact_email ?? ""}
                    onChange={(e) => setEditing({ ...editing, primary_contact_email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact phone (optional)</Label>
                  <Input
                    value={editing.primary_contact_phone ?? ""}
                    onChange={(e) => setEditing({ ...editing, primary_contact_phone: e.target.value })}
                  />
                </div>
              </div>
              {!editing.id && (editing.primary_contact_email ?? "").trim() !== "" && (
                <label className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <Checkbox checked={inviteContact} onCheckedChange={(v) => setInviteContact(v === true)} />
                  Invite this contact as Distributor Admin after saving
                </label>
              )}
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch
                  checked={editing.is_active}
                  onCheckedChange={(v) => setEditing({ ...editing, is_active: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={submitDistributor} disabled={saveDistributor.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
