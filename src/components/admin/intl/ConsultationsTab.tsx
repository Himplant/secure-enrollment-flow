import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, Search, Globe } from "lucide-react";
import { formatIntlMoney, COUNTRY_LABEL } from "@/lib/intlMoney";
import { IntlStatusBadge } from "@/components/intl/IntlStatusBadge";
import type { IntlConsultationStatus, IntlPaymentStatus } from "@/lib/intlStatus";
import { CreateConsultationModal } from "./CreateConsultationModal";

interface ConsultationRow {
  id: string;
  created_at: string;
  amount_minor: number;
  currency: string;
  country: string;
  provider: string;
  payment_status: IntlPaymentStatus;
  consultation_status: IntlConsultationStatus;
  token_last4: string;
  surgeon: { name: string } | null;
  patient: { full_name: string; email: string | null } | null;
}

export function ConsultationsTab() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["intl-consultations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultations")
        .select(
          "id, created_at, amount_minor, currency, country, provider, payment_status, consultation_status, token_last4, surgeon:surgeons(name), patient:consultation_patients(full_name, email)",
        )
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as ConsultationRow[];
    },
  });

  const term = search.trim().toLowerCase();
  const rows = (data ?? []).filter((r) =>
    !term
      ? true
      : [r.patient?.full_name, r.patient?.email, r.surgeon?.name, r.token_last4]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term)),
  );

  return (
    <div className="space-y-4">
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
            <p className="py-12 text-center text-sm text-muted-foreground">
              No consultations yet.
            </p>
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
                    <TableRow key={r.id}>
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

      <CreateConsultationModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["intl-consultations"] })}
      />
    </div>
  );
}
