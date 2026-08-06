import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, Search, Globe, X } from "lucide-react";
import { formatIntlMoney, COUNTRY_LABEL } from "@/lib/intlMoney";
import { IntlStatusBadge } from "@/components/intl/IntlStatusBadge";
import type { IntlConsultationStatus, IntlPaymentStatus } from "@/lib/intlStatus";
import { CreateConsultationModal } from "./CreateConsultationModal";
import { ConsultationDetailDrawer } from "./ConsultationDetailDrawer";

interface ConsultationRow {
  id: string;
  created_at: string;
  amount_minor: number;
  currency: string;
  country: string;
  provider: string;
  agent_email: string | null;
  payment_status: IntlPaymentStatus;
  consultation_status: IntlConsultationStatus;
  surgery_status: string;
  token_last4: string;
  paid_at: string | null;
  first_contact_at: string | null;
  scheduled_at: string | null;
  surgeon_id: string | null;
  distributor_id: string | null;
  surgeon: { name: string } | null;
  distributor: { name: string } | null;
  patient: { full_name: string; email: string | null } | null;
}

const ALL = "all";
const SLA_HOURS = 24;

function isOverdue(r: ConsultationRow) {
  return (
    r.payment_status === "approved" &&
    !r.first_contact_at &&
    !!r.paid_at &&
    Date.now() - new Date(r.paid_at).getTime() > SLA_HOURS * 3600_000
  );
}

export function ConsultationsTab() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    country: ALL,
    distributor: ALL,
    surgeon: ALL,
    agent: ALL,
    provider: ALL,
    payment: ALL,
    consultation: ALL,
    surgery: ALL,
    sla: ALL,
  });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["intl-consultations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultations")
        .select(
          "id, created_at, amount_minor, currency, country, provider, agent_email, payment_status, consultation_status, surgery_status, token_last4, paid_at, first_contact_at, scheduled_at, surgeon_id, distributor_id, surgeon:surgeons(name), distributor:distributors(name), patient:consultation_patients(full_name, email)",
        )
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as unknown as ConsultationRow[];
    },
  });

  const all = useMemo(() => data ?? [], [data]);

  const options = useMemo(() => {
    const uniq = (vals: (string | null | undefined)[]) =>
      Array.from(new Set(vals.filter((v): v is string => !!v))).sort();
    return {
      countries: uniq(all.map((r) => r.country)),
      distributors: uniq(all.map((r) => r.distributor?.name)),
      surgeons: uniq(all.map((r) => r.surgeon?.name)),
      agents: uniq(all.map((r) => r.agent_email)),
      providers: uniq(all.map((r) => r.provider)),
      payments: uniq(all.map((r) => r.payment_status)),
      consultations: uniq(all.map((r) => r.consultation_status)),
      surgeries: uniq(all.map((r) => r.surgery_status)),
    };
  }, [all]);

  const term = search.trim().toLowerCase();
  const rows = all.filter((r) => {
    if (
      term &&
      ![r.patient?.full_name, r.patient?.email, r.surgeon?.name, r.token_last4]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    )
      return false;
    if (filters.country !== ALL && r.country !== filters.country) return false;
    if (filters.distributor !== ALL && (r.distributor?.name ?? "") !== filters.distributor) return false;
    if (filters.surgeon !== ALL && (r.surgeon?.name ?? "") !== filters.surgeon) return false;
    if (filters.agent !== ALL && (r.agent_email ?? "") !== filters.agent) return false;
    if (filters.provider !== ALL && r.provider !== filters.provider) return false;
    if (filters.payment !== ALL && r.payment_status !== filters.payment) return false;
    if (filters.consultation !== ALL && r.consultation_status !== filters.consultation) return false;
    if (filters.surgery !== ALL && r.surgery_status !== filters.surgery) return false;
    if (filters.sla === "overdue" && !isOverdue(r)) return false;
    if (filters.sla === "on_track" && isOverdue(r)) return false;
    if (from && new Date(r.created_at) < new Date(from)) return false;
    if (to && new Date(r.created_at) > new Date(`${to}T23:59:59`)) return false;
    return true;
  });

  const summary = useMemo(() => {
    const awaitingPayment = rows.filter((r) =>
      ["link_created", "link_sent", "link_opened"].includes(r.payment_status),
    ).length;
    const paidAwaitingContact = rows.filter(
      (r) => r.payment_status === "approved" && !r.first_contact_at,
    ).length;
    const overdue = rows.filter(isOverdue).length;
    const scheduled = rows.filter((r) => r.consultation_status === "scheduled").length;
    const completed = rows.filter((r) => r.consultation_status === "completed").length;
    return { awaitingPayment, paidAwaitingContact, overdue, scheduled, completed };
  }, [rows]);

  const { data: outboxFailures } = useQuery({
    queryKey: ["intl-outbox-failures"],
    queryFn: async () => {
      const { count } = await supabase
        .from("intl_zoho_outbox")
        .select("id", { count: "exact", head: true })
        .in("status", ["failed", "dead"]);
      return count ?? 0;
    },
  });

  const setFilter = (key: keyof typeof filters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const resetFilters = () => {
    setFilters({
      country: ALL, distributor: ALL, surgeon: ALL, agent: ALL, provider: ALL,
      payment: ALL, consultation: ALL, surgery: ALL, sla: ALL,
    });
    setFrom("");
    setTo("");
  };

  const filterSelect = (
    key: keyof typeof filters,
    label: string,
    values: string[],
    format: (v: string) => string = (v) => v.replace(/_/g, " "),
  ) => (
    <Select value={filters[key]} onValueChange={(v) => setFilter(key, v)}>
      <SelectTrigger className="h-9 w-[150px] capitalize">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: all</SelectItem>
        {values.map((v) => (
          <SelectItem key={v} value={v} className="capitalize">
            {format(v)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const cards = [
    { label: "Awaiting payment", value: summary.awaitingPayment },
    { label: "Paid — awaiting contact", value: summary.paidAwaitingContact },
    { label: "Overdue SLA", value: summary.overdue },
    { label: "Scheduled", value: summary.scheduled },
    { label: "Completed", value: summary.completed },
    { label: "Zoho sync failures", value: outboxFailures ?? 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <div className="text-2xl font-semibold">{c.value}</div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search patient, surgeon or link"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New consultation link
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filterSelect("country", "Country", options.countries, (v) => COUNTRY_LABEL[v] ?? v)}
        {filterSelect("distributor", "Distributor", options.distributors)}
        {filterSelect("surgeon", "Surgeon", options.surgeons)}
        {filterSelect("agent", "Agent", options.agents)}
        {filterSelect("provider", "Provider", options.providers)}
        {filterSelect("payment", "Payment", options.payments)}
        {filterSelect("consultation", "Consultation", options.consultations)}
        {filterSelect("surgery", "Surgery", options.surgeries)}
        {filterSelect("sla", "SLA", ["overdue", "on_track"])}
        <Input type="date" className="h-9 w-[150px]" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="h-9 w-[150px]" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button variant="ghost" size="sm" className="gap-1" onClick={resetFilters}>
          <X className="h-3.5 w-3.5" /> Reset
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            International consultations ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No consultations match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Surgeon</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Consultation</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => setDetailId(r.id)}
                    >
                      <TableCell>
                        <div className="font-medium">{r.patient?.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.patient?.email ?? ""}</div>
                      </TableCell>
                      <TableCell>{r.surgeon?.name ?? "—"}</TableCell>
                      <TableCell>{COUNTRY_LABEL[r.country] ?? r.country}</TableCell>
                      <TableCell>{formatIntlMoney(r.amount_minor, r.currency)}</TableCell>
                      <TableCell>
                        <IntlStatusBadge kind="payment" status={r.payment_status} />
                      </TableCell>
                      <TableCell>
                        <IntlStatusBadge kind="consultation" status={r.consultation_status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConsultationDetailDrawer
        consultationId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
      />

      <CreateConsultationModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["intl-consultations"] })}
      />
    </div>
  );
}
