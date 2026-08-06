import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { formatIntlMoney, COUNTRY_LABEL } from "@/lib/intlMoney";
import { usePortalMetrics } from "@/hooks/usePortalMetrics";

const pct = (v: number) => `${v.toFixed(1)}%`;
const hours = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}h`);

function moneyList(byCurrency: Record<string, number>) {
  const entries = Object.entries(byCurrency);
  if (entries.length === 0) return "—";
  return entries.map(([c, minor]) => formatIntlMoney(minor, c)).join(" · ");
}

/**
 * Distributor network overview — strictly read-only.
 * Scope is derived server-side from the active distributor workspace, so this
 * can only ever show surgeons assigned to that distributor.
 */
export default function PortalDistributorDashboard() {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, isLoading, isFetching, error } = usePortalMetrics({ from, to });

  const totals = data?.totals;
  const bySurgeon = useMemo(() => data?.by_surgeon ?? [], [data]);
  const byCountry = useMemo(() => data?.by_country ?? [], [data]);

  const cards = totals
    ? [
        { label: "Links created", value: String(totals.links_created) },
        { label: "Payments approved", value: String(totals.payments_approved) },
        { label: "Payment conversion", value: pct(totals.payment_conversion_rate) },
        { label: "Gross collected", value: moneyList(totals.gross_paid_minor_by_currency) },
        { label: "Awaiting clinic contact", value: String(totals.awaiting_contact) },
        { label: "Median time to contact", value: hours(totals.median_hours_to_first_contact) },
        { label: "Consultations completed", value: String(totals.consultations_completed) },
        { label: "No-show rate", value: pct(totals.no_show_rate) },
      ]
    : [];

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Network overview</h1>
            <p className="text-sm text-muted-foreground">
              Read-only performance across the surgeons assigned to your distributorship.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => queryClient.invalidateQueries({ queryKey: ["portal-metrics"] })}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {(error as Error).message}
          </p>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {cards.map((c) => (
                <Card key={c.label}>
                  <CardContent className="p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</p>
                    <p className="mt-1 text-xl font-semibold">{c.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Surgeon performance</CardTitle>
              </CardHeader>
              <CardContent>
                {bySurgeon.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No consultation activity in this period.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Surgeon</TableHead>
                          <TableHead className="text-right">Links</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead className="text-right">Conversion</TableHead>
                          <TableHead className="text-right">Median contact</TableHead>
                          <TableHead className="text-right">Completed</TableHead>
                          <TableHead className="text-right">No-show</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bySurgeon.map((s) => (
                          <TableRow key={s.surgeon_id}>
                            <TableCell className="font-medium">{s.surgeon_name}</TableCell>
                            <TableCell className="text-right">{s.links_created}</TableCell>
                            <TableCell className="text-right">{s.payments_approved}</TableCell>
                            <TableCell className="text-right">{pct(s.payment_conversion_rate)}</TableCell>
                            <TableCell className="text-right">
                              {hours(s.median_hours_to_first_contact)}
                            </TableCell>
                            <TableCell className="text-right">{s.consultations_completed}</TableCell>
                            <TableCell className="text-right">{pct(s.no_show_rate)}</TableCell>
                            <TableCell className="text-right text-sm">
                              {moneyList(s.gross_paid_minor_by_currency)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {byCountry.length > 1 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">By country</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Country</TableHead>
                          <TableHead className="text-right">Links</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead className="text-right">Conversion</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {byCountry.map((c) => (
                          <TableRow key={c.country}>
                            <TableCell>{COUNTRY_LABEL[c.country] ?? c.country}</TableCell>
                            <TableCell className="text-right">{c.links_created}</TableCell>
                            <TableCell className="text-right">{c.payments_approved}</TableCell>
                            <TableCell className="text-right">{pct(c.payment_conversion_rate)}</TableCell>
                            <TableCell className="text-right text-sm">
                              {moneyList(c.gross_paid_minor_by_currency)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </PortalLayout>
  );
}
