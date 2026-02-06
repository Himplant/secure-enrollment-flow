import { useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

interface StatusFunnelChartProps {
  stats: {
    created: number;
    sent: number;
    opened: number;
    processing: number;
    paid: number;
    failed: number;
    expired: number;
    canceled: number;
    total: number;
  } | null;
  isLoading: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  Created: "hsl(var(--muted-foreground))",
  Sent: "hsl(217, 91%, 60%)",
  Opened: "hsl(280, 65%, 60%)",
  Processing: "hsl(var(--warning))",
  Paid: "hsl(var(--success))",
  Failed: "hsl(var(--destructive))",
  Expired: "hsl(var(--muted-foreground))",
  Canceled: "hsl(var(--border))",
};

const renderCustomLabel = ({ name, percent, cx, x, y, midAngle }: any) => {
  if (percent < 0.04) return null;
  const pct = (percent * 100).toFixed(1);
  return (
    <text
      x={x}
      y={y}
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      style={{ fontSize: "11px", fill: "hsl(var(--foreground))" }}
    >
      {name} {pct}%
    </text>
  );
};

export function StatusFunnelChart({ stats, isLoading }: StatusFunnelChartProps) {
  const donutData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: "Paid", value: stats.paid },
      { name: "Processing", value: stats.processing },
      { name: "Opened", value: stats.opened },
      { name: "Sent", value: stats.sent },
      { name: "Created", value: stats.created },
      { name: "Failed", value: stats.failed },
      { name: "Expired", value: stats.expired },
      { name: "Canceled", value: stats.canceled },
    ].filter((d) => d.value > 0);
  }, [stats]);

  const funnelData = useMemo(() => {
    if (!stats || stats.total === 0) return [];
    const steps = [
      { label: "Created", value: stats.total, pct: 100 },
      { label: "Sent", value: stats.sent + stats.opened + stats.processing + stats.paid, pct: 0 },
      { label: "Opened", value: stats.opened + stats.processing + stats.paid, pct: 0 },
      { label: "Paid", value: stats.paid, pct: 0 },
    ];
    steps.forEach((s) => {
      s.pct = Math.round((s.value / stats.total) * 100);
    });
    return steps;
  }, [stats]);

  if (isLoading) {
    return (
      <Card className="card-premium">
        <CardHeader>
          <CardTitle className="text-lg">Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[280px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <Card className="card-premium">
        <CardHeader>
          <CardTitle className="text-lg">Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-12">No data for this period</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-premium">
      <CardHeader>
        <CardTitle className="text-lg">Status Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Donut chart with percentage labels */}
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={donutData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={85}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                label={renderCustomLabel}
                labelLine={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
              >
                {donutData.map((entry) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(value: number, name: string) => {
                  const pct = stats.total > 0 ? ((value / stats.total) * 100).toFixed(1) : "0";
                  return [`${value} (${pct}%)`, name];
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Status table with percentages */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {donutData.map((d) => {
            const pct = stats.total > 0 ? ((d.value / stats.total) * 100).toFixed(1) : "0";
            return (
              <div key={d.name} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[d.name] }} />
                  <span className="text-foreground">{d.name}</span>
                </div>
                <span className="text-muted-foreground font-medium">{d.value} <span className="text-xs">({pct}%)</span></span>
              </div>
            );
          })}
        </div>

        {/* Conversion funnel */}
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-3">Conversion Funnel</p>
          <div className="space-y-2">
            {funnelData.map((step, i) => (
              <div key={step.label} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground">{step.label}</span>
                  <span className="text-muted-foreground">
                    {step.value} ({step.pct}%)
                  </span>
                </div>
                <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${step.pct}%`,
                      backgroundColor:
                        i === funnelData.length - 1
                          ? "hsl(var(--success))"
                          : "hsl(var(--primary))",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
