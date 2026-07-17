import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, TrendingUp, TrendingDown, Clock, AlertTriangle, CheckCircle2, XCircle, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import {
  computeTotals, computeBySurgeon, fmtCents,
  type EnrollmentRow, type CreditRow,
} from "@/lib/creditEconomics";

interface Props {
  enrollments: any[]; // filtered by date/surgeon/consultant at dashboard level
  dateFrom?: Date;
  dateTo?: Date;
  surgeonFilter: string;   // "all" | "unassigned" | surgeon id
  consultantFilter: string; // "all" | "unassigned" | consultant name
}

export function CreditEconomicsTab({ enrollments, dateFrom, dateTo, surgeonFilter, consultantFilter }: Props) {
  const { data: creditsRaw = [], isLoading } = useQuery({
    queryKey: ["credit-economics", dateFrom?.toISOString(), dateTo?.toISOString()],
    queryFn: async () => {
      let q = supabase
        .from("surgeon_credits")
        .select("surgeon_id, surgeon_name, credit_amount, issued_amount, credit_status, patient_email, consultant_email, enrollment_date");
      if (dateFrom) q = q.gte("enrollment_date", dateFrom.toISOString().slice(0, 10));
      if (dateTo) {
        const to = new Date(dateTo); to.setHours(23, 59, 59, 999);
        q = q.lte("enrollment_date", to.toISOString().slice(0, 10));
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const credits: CreditRow[] = useMemo(() => {
    let list = creditsRaw as CreditRow[];
    if (surgeonFilter !== "all") {
      list = surgeonFilter === "unassigned"
        ? list.filter(c => !c.surgeon_id)
        : list.filter(c => c.surgeon_id === surgeonFilter);
    }
    if (consultantFilter !== "all") {
      const norm = consultantFilter.toLowerCase();
      list = consultantFilter === "unassigned"
        ? list.filter(c => !c.consultant_email)
        : list.filter(c => (c.consultant_email || "").toLowerCase().includes(norm));
    }
    return list;
  }, [creditsRaw, surgeonFilter, consultantFilter]);

  const totals = useMemo(() => computeTotals(enrollments as EnrollmentRow[], credits), [enrollments, credits]);
  const bySurgeon = useMemo(() => computeBySurgeon(enrollments as EnrollmentRow[], credits), [enrollments, credits]);

  const kpis = [
    { title: "Collected", value: fmtCents(totals.collectedCents), subtitle: `${totals.paidCount} paid − ${totals.refundedCount} refunded`, icon: DollarSign, tone: "text-success", bg: "bg-success/10" },
    { title: "Paid Out to Surgeons", value: fmtCents(totals.paidOutCents), subtitle: `${totals.issuedCount} credits issued`, icon: CheckCircle2, tone: "text-primary", bg: "bg-primary/10" },
    { title: "Earned – Owed", value: fmtCents(totals.earnedOwedCents), subtitle: `${totals.earnedCount} credits owed`, icon: Clock, tone: "text-warning", bg: "bg-warning/10" },
    { title: "Pending Liability", value: fmtCents(totals.pendingLiabilityCents), subtitle: `${totals.pendingCount} in-window`, icon: AlertTriangle, tone: "text-muted-foreground", bg: "bg-muted" },
    { title: "Overpayment (realized)", value: fmtCents(totals.overpayRealizedCents), subtitle: "$250 gap on redeemed $750 credits", icon: TrendingDown, tone: "text-destructive", bg: "bg-destructive/10" },
    { title: "Overpayment (potential)", value: fmtCents(totals.overpayPotentialCents), subtitle: "if all pending $750 redeem", icon: TrendingDown, tone: "text-destructive", bg: "bg-destructive/10" },
    { title: "Forfeited (gain)", value: fmtCents(totals.forfeitedGainCents), subtitle: `${totals.forfeitedCount} deposits kept`, icon: XCircle, tone: "text-success", bg: "bg-success/10" },
    { title: "Net Position", value: fmtCents(totals.netPositionCents), subtitle: "Collected − Payouts − Owed − Overpay + Forfeited", icon: Scale, tone: totals.netPositionCents >= 0 ? "text-success" : "text-destructive", bg: totals.netPositionCents >= 0 ? "bg-success/10" : "bg-destructive/10" },
  ];

  const chartData = bySurgeon.slice(0, 12).map(s => ({
    name: s.surgeonName.length > 18 ? s.surgeonName.slice(0, 16) + "…" : s.surgeonName,
    "Paid Out": s.paidOutCents / 100,
    "Owed (Earned)": s.earnedOwedCents / 100,
    "Pending": s.pendingLiabilityCents / 100,
  }));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="card-premium"><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.title} className="card-premium">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">{k.title}</p>
                  <p className="text-2xl font-bold text-foreground">{k.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{k.subtitle}</p>
                </div>
                <div className={`w-10 h-10 rounded-lg ${k.bg} flex items-center justify-center`}>
                  <k.icon className={`h-5 w-5 ${k.tone}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Liability stack chart */}
      <Card className="card-premium">
        <CardHeader><CardTitle className="text-base">Payouts + Liability by Surgeon</CardTitle></CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No data in current filter range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" angle={-30} textAnchor="end" height={60} className="text-xs" />
                <YAxis tickFormatter={(v) => `$${v}`} className="text-xs" />
                <Tooltip formatter={(v: number) => fmtCents(v * 100)} />
                <Legend />
                <Bar dataKey="Paid Out" stackId="a" fill="hsl(var(--primary))" />
                <Bar dataKey="Owed (Earned)" stackId="a" fill="hsl(var(--warning))" />
                <Bar dataKey="Pending" stackId="a" fill="hsl(var(--muted-foreground))" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-surgeon table */}
      <Card className="card-premium">
        <CardHeader><CardTitle className="text-base">Economics by Surgeon</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Surgeon</TableHead>
                  <TableHead className="text-right">Enrolled</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Paid Out</TableHead>
                  <TableHead className="text-right">Owed (Earned)</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Overpay (real)</TableHead>
                  <TableHead className="text-right">Overpay (pot.)</TableHead>
                  <TableHead className="text-right">Forfeited</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySurgeon.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>
                ) : bySurgeon.map(s => (
                  <TableRow key={(s.surgeonId ?? "unassigned") + s.surgeonName}>
                    <TableCell className="font-medium">{s.surgeonName}</TableCell>
                    <TableCell className="text-right">{s.enrolledCount}</TableCell>
                    <TableCell className="text-right">{fmtCents(s.collectedCents)}</TableCell>
                    <TableCell className="text-right">{fmtCents(s.paidOutCents)}</TableCell>
                    <TableCell className="text-right text-warning">{fmtCents(s.earnedOwedCents)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtCents(s.pendingLiabilityCents)}</TableCell>
                    <TableCell className="text-right text-destructive">{fmtCents(s.overpayRealizedCents)}</TableCell>
                    <TableCell className="text-right text-destructive/70">{fmtCents(s.overpayPotentialCents)}</TableCell>
                    <TableCell className="text-right text-success">{fmtCents(s.forfeitedGainCents)}</TableCell>
                    <TableCell className={`text-right font-semibold ${s.netCents >= 0 ? "text-success" : "text-destructive"}`}>
                      {fmtCents(s.netCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
