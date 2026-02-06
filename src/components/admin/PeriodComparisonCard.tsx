import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { differenceInMilliseconds } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

interface PeriodComparisonCardProps {
  dateFrom?: Date;
  dateTo?: Date;
  currentStats: {
    total: number;
    paid: number;
    totalPaidAmount: number;
    conversionRate: number;
  } | null;
  isLoading: boolean;
}

export function PeriodComparisonCard({ dateFrom, dateTo, currentStats, isLoading }: PeriodComparisonCardProps) {
  const prevRange = useMemo(() => {
    if (!dateFrom || !dateTo) return null;
    const diff = differenceInMilliseconds(dateTo, dateFrom);
    const prevTo = new Date(dateFrom.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - diff);
    return { from: prevFrom, to: prevTo };
  }, [dateFrom, dateTo]);

  const { data: prevStats, isLoading: prevLoading } = useQuery({
    queryKey: ["prev-period-stats", prevRange?.from?.toISOString(), prevRange?.to?.toISOString()],
    enabled: !!prevRange,
    queryFn: async () => {
      if (!prevRange) return null;
      const { data, error } = await supabase
        .from("enrollments")
        .select("status, amount_cents")
        .gte("created_at", prevRange.from.toISOString())
        .lte("created_at", prevRange.to.toISOString());
      if (error) throw error;
      const rows = data || [];
      const total = rows.length;
      const paid = rows.filter(e => e.status === "paid").length;
      const totalPaidAmount = rows.filter(e => e.status === "paid").reduce((s, e) => s + e.amount_cents, 0);
      const conversionRate = total > 0 ? (paid / total) * 100 : 0;
      return { total, paid, totalPaidAmount, conversionRate };
    },
  });

  const metrics = useMemo(() => {
    if (!currentStats || !prevStats) return [];
    const fmt = (cents: number) =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(cents / 100);
    const delta = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return ((curr - prev) / prev) * 100;
    };
    return [
      { label: "Enrollments", current: currentStats.total, prev: prevStats.total, change: delta(currentStats.total, prevStats.total), format: (v: number) => String(v) },
      { label: "Paid", current: currentStats.paid, prev: prevStats.paid, change: delta(currentStats.paid, prevStats.paid), format: (v: number) => String(v) },
      { label: "Revenue", current: currentStats.totalPaidAmount, prev: prevStats.totalPaidAmount, change: delta(currentStats.totalPaidAmount, prevStats.totalPaidAmount), format: (v: number) => fmt(v) },
      { label: "Conversion", current: currentStats.conversionRate, prev: prevStats.conversionRate, change: currentStats.conversionRate - prevStats.conversionRate, format: (v: number) => `${v.toFixed(1)}%`, isDiff: true as const },
    ];
  }, [currentStats, prevStats]);

  if (!dateFrom || !dateTo) return null;

  const loading = isLoading || prevLoading;

  if (loading) {
    return (
      <Card className="card-premium">
        <CardHeader><CardTitle className="text-lg">vs Previous Period</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-[120px] w-full" /></CardContent>
      </Card>
    );
  }

  if (!metrics.length) return null;

  return (
    <Card className="card-premium">
      <CardHeader><CardTitle className="text-lg">vs Previous Period</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metrics.map((m) => {
            const isPositive = m.change > 0;
            const isNeutral = Math.abs(m.change) < 0.5;
            return (
              <div key={m.label} className="space-y-1">
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <p className="text-lg font-bold text-foreground">{m.format(m.current)}</p>
                <div className="flex items-center gap-1">
                  {isNeutral ? (
                    <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : isPositive ? (
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                  )}
                  <span className={`text-xs font-medium ${isNeutral ? "text-muted-foreground" : isPositive ? "text-success" : "text-destructive"}`}>
                    {"isDiff" in m
                      ? `${m.change > 0 ? "+" : ""}${m.change.toFixed(1)}pp`
                      : `${m.change > 0 ? "+" : ""}${m.change.toFixed(1)}%`}
                  </span>
                  <span className="text-xs text-muted-foreground">vs {m.format(m.prev)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
