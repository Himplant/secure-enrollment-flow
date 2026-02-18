import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface ConsultantStats {
  name: string;
  count: number;
  amount: number;
}

const COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ef4444", // red
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
];

export function ConsultantDistributionCard() {
  const { data: stats = [], isLoading } = useQuery({
    queryKey: ["consultant-distribution"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrollments")
        .select("amount_cents, owner_name")
        .eq("status", "paid");

      if (error) throw error;

      const map = new Map<string, { count: number; amount: number }>();
      data?.forEach((e: any) => {
        const name = e.owner_name || "Unassigned";
        const cur = map.get(name) || { count: 0, amount: 0 };
        cur.count += 1;
        cur.amount += e.amount_cents;
        map.set(name, cur);
      });

      return Array.from(map.entries())
        .map(([name, d]) => ({ name, count: d.count, amount: d.amount }))
        .sort((a, b) => b.amount - a.amount) as ConsultantStats[];
    },
  });

  const fmt = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(cents / 100);

  const totalPaid = stats.reduce((s, c) => s + c.amount, 0);
  const totalCount = stats.reduce((s, c) => s + c.count, 0);

  if (isLoading) {
    return (
      <Card className="card-premium">
        <CardHeader><CardTitle className="text-lg">Revenue by Consultant</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-[200px] w-full" /></CardContent>
      </Card>
    );
  }

  if (!stats.length) {
    return (
      <Card className="card-premium">
        <CardHeader><CardTitle className="text-lg">Revenue by Consultant</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground text-center py-8">No paid transactions yet</p></CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-premium">
      <CardHeader><CardTitle className="text-lg">Revenue by Consultant</CardTitle></CardHeader>
      <CardContent>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={stats}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={80}
                paddingAngle={2}
                dataKey="amount"
                nameKey="name"
                label={({ name, percent }) => `${name.split(" ")[0]} (${(percent * 100).toFixed(0)}%)`}
                labelLine={false}
              >
                {stats.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number, name: string) => [fmt(value), name]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 space-y-2">
          {stats.slice(0, 5).map((c, i) => (
            <div key={c.name} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <span className="text-foreground">{c.name}</span>
              </div>
              <div className="text-right">
                <span className="font-medium text-foreground">{fmt(c.amount)}</span>
                <span className="text-muted-foreground ml-2">({c.count} paid)</span>
              </div>
            </div>
          ))}
          {stats.length > 5 && (
            <p className="text-xs text-muted-foreground text-center">+ {stats.length - 5} more</p>
          )}
        </div>
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-medium text-foreground">{fmt(totalPaid)} ({totalCount} transactions)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
