import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { usePortalMetrics, type PortalMetricGroup } from "@/hooks/usePortalMetrics";
import { formatMinor } from "@/lib/intlMoney";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const hours = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} h`);

function money(byCurrency: Record<string, number>) {
  const entries = Object.entries(byCurrency ?? {});
  if (!entries.length) return "—";
  return entries.map(([c, minor]) => formatMinor(minor, c)).join(" · ");
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function BreakdownTable({
  title,
  label,
  rows,
}: {
  title: string;
  label: string;
  rows: (PortalMetricGroup & { name: string })[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{label}</TableHead>
              <TableHead className="text-right">Links</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Conversion</TableHead>
              <TableHead className="text-right">Median to contact</TableHead>
              <TableHead className="text-right">No-show</TableHead>
              <TableHead className="text-right">Surgery scheduled</TableHead>
              <TableHead className="text-right">Gross paid</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  No consultations in this period.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right">{r.links_created}</TableCell>
                <TableCell className="text-right">{r.payments_approved}</TableCell>
                <TableCell className="text-right">{pct(r.payment_conversion_rate)}</TableCell>
                <TableCell className="text-right">{hours(r.median_hours_to_first_contact)}</TableCell>
                <TableCell className="text-right">{pct(r.no_show_rate)}</TableCell>
                <TableCell className="text-right">{pct(r.surgery_scheduled_rate)}</TableCell>
                <TableCell className="text-right">{money(r.gross_paid_minor_by_currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Scoped reporting for surgeons and distributors. */
export default function PortalReports() {
  const [surgeonId, setSurgeonId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, isLoading, error } = usePortalMetrics({
    surgeonId: surgeonId === "all" ? undefined : surgeonId,
    from,
    to,
  });

  const totals = data?.totals;
  const bySurgeon = useMemo(
    () => (data?.by_surgeon ?? []).map((r) => ({ ...r, name: r.surgeon_name })),
    [data],
  );
  const byCountry = useMemo(
    () => (data?.by_country ?? []).map((r) => ({ ...r, name: r.country })),
    [data],
  );

  return (
    <PortalLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Conversion, response time and payment performance for your consultations.
          </p>
        </div>

        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Surgeon</Label>
              <Select value={surgeonId} onValueChange={setSurgeonId}>
                <SelectTrigger>
                  <SelectValue placeholder="All surgeons" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All surgeons</SelectItem>
                  {(data?.surgeons ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {error && (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">
              {(error as Error).message}
            </CardContent>
          </Card>
        )}

        {totals && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Links created" value={String(totals.links_created)} />
              <StatCard
                label="Payments approved"
                value={String(totals.payments_approved)}
                hint={`${pct(totals.payment_conversion_rate)} conversion`}
              />
              <StatCard
                label="Awaiting contact"
                value={String(totals.awaiting_contact)}
                hint={`Median ${hours(totals.median_hours_to_first_contact)} to first contact`}
              />
              <StatCard label="Gross paid" value={money(totals.gross_paid_minor_by_currency)} />
              <StatCard label="Scheduled" value={String(totals.consultations_scheduled)} />
              <StatCard
                label="Completed"
                value={String(totals.consultations_completed)}
                hint={`${pct(totals.no_show_rate)} no-show`}
              />
              <StatCard
                label="Surgery recommended"
                value={pct(totals.surgery_recommended_rate)}
                hint={`${pct(totals.surgery_completed_rate)} completed`}
              />
              <StatCard
                label="Refunds / disputes"
                value={`${pct(totals.refund_rate)} / ${pct(totals.dispute_rate)}`}
              />
            </div>

            <BreakdownTable title="By surgeon" label="Surgeon" rows={bySurgeon} />
            <BreakdownTable title="By country" label="Country" rows={byCountry} />
          </>
        )}
      </div>
    </PortalLayout>
  );
}
