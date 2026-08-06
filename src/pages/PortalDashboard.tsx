import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { PortalConsultationSheet } from "@/components/portal/PortalConsultationSheet";
import { IntlStatusBadge } from "@/components/intl/IntlStatusBadge";
import { formatIntlMoney, COUNTRY_LABEL } from "@/lib/intlMoney";
import { usePortalConsultations } from "@/hooks/usePortalConsultations";
import { usePortalWorkspace } from "@/hooks/usePortalWorkspace";
import { CONSULTATION_STATUS_META, PAYMENT_STATUS_META } from "@/lib/intlStatus";

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function PortalDashboard() {
  const queryClient = useQueryClient();
  const [surgeonId, setSurgeonId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [consultationStatus, setConsultationStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, isFetching, error } = usePortalConsultations({
    surgeonId,
    paymentStatus,
    consultationStatus,
  });

  const rows = useMemo(() => {
    const list = data?.consultations ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      [r.patient?.full_name, r.patient?.email, r.patient?.phone, r.token_last4, r.surgeon?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [data, search]);

  const stats = useMemo(() => {
    const list = data?.consultations ?? [];
    return {
      total: list.length,
      awaitingPayment: list.filter((r) => r.payment_status !== "approved").length,
      awaitingContact: list.filter(
        (r) => r.payment_status === "approved" && r.consultation_status === "awaiting_clinic_contact",
      ).length,
      scheduled: list.filter((r) =>
        ["scheduled", "rescheduled"].includes(r.consultation_status),
      ).length,
    };
  }, [data]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["portal-consultations"] });
  };

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Consultations</h1>
            <p className="text-sm text-muted-foreground">
              Records assigned to your surgeons only.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Total", value: stats.total },
            { label: "Awaiting payment", value: stats.awaitingPayment },
            { label: "Awaiting contact", value: stats.awaitingContact },
            { label: "Scheduled", value: stats.scheduled },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
                <p className="mt-1 text-2xl font-semibold">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search patient, email, phone, link"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={surgeonId || "all"} onValueChange={(v) => setSurgeonId(v === "all" ? "" : v)}>
                <SelectTrigger className="md:w-52"><SelectValue placeholder="All surgeons" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All surgeons</SelectItem>
                  {(data?.surgeons ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={paymentStatus || "all"}
                onValueChange={(v) => setPaymentStatus(v === "all" ? "" : v)}
              >
                <SelectTrigger className="md:w-44"><SelectValue placeholder="Payment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any payment</SelectItem>
                  {Object.entries(PAYMENT_STATUS_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={consultationStatus || "all"}
                onValueChange={(v) => setConsultationStatus(v === "all" ? "" : v)}
              >
                <SelectTrigger className="md:w-48"><SelectValue placeholder="Consultation" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any stage</SelectItem>
                  {Object.entries(CONSULTATION_STATUS_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {(error as Error).message}
              </p>
            )}

            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No consultations match these filters.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient</TableHead>
                      <TableHead>Surgeon</TableHead>
                      <TableHead>Fee</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Consultation</TableHead>
                      <TableHead>Scheduled</TableHead>
                      <TableHead className="text-right">Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(r.id)}
                      >
                        <TableCell>
                          <div className="font-medium">{r.patient?.full_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.patient?.email ?? r.patient?.phone ?? COUNTRY_LABEL[r.country] ?? r.country}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{r.surgeon?.name ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {formatIntlMoney(r.amount_minor, r.currency)}
                        </TableCell>
                        <TableCell><IntlStatusBadge kind="payment" status={r.payment_status} /></TableCell>
                        <TableCell>
                          <IntlStatusBadge kind="consultation" status={r.consultation_status} />
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(r.scheduled_at)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {fmtDate(r.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <PortalConsultationSheet
        consultationId={selectedId}
        readOnly={isDistributor}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </PortalLayout>
  );
}
