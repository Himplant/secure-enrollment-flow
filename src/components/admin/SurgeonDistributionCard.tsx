import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface SurgeonStats {
  name: string;
  count: number;
  amount: number;
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export function SurgeonDistributionCard() {
  const { data: surgeonStats = [], isLoading } = useQuery({
    queryKey: ["surgeon-distribution"],
    queryFn: async () => {
      // Get all paid enrollments with patient info
      const { data: enrollments, error } = await supabase
        .from("enrollments")
        .select(`
          amount_cents,
          status,
          patients!enrollments_patient_id_fkey (
            surgeon_id,
            surgeon:surgeons(id, name)
          )
        `)
        .eq("status", "paid");

      if (error) throw error;

      // Aggregate by surgeon
      const surgeonMap = new Map<string, { count: number; amount: number }>();

      enrollments?.forEach((enrollment: any) => {
        const surgeonName = enrollment.patients?.surgeon?.name || "Unassigned";
        const current = surgeonMap.get(surgeonName) || { count: 0, amount: 0 };
        current.count += 1;
        current.amount += enrollment.amount_cents;
        surgeonMap.set(surgeonName, current);
      });

      // Convert to array and sort by count
      const stats: SurgeonStats[] = Array.from(surgeonMap.entries())
        .map(([name, data]) => ({
          name,
          count: data.count,
          amount: data.amount,
        }))
        .sort((a, b) => b.count - a.count);

      return stats;
    },
  });

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(cents / 100);
  };

  const totalPaid = surgeonStats.reduce((sum, s) => sum + s.amount, 0);
  const totalCount = surgeonStats.reduce((sum, s) => sum + s.count, 0);

  if (isLoading) {
    return (
      <Card className="card-premium">
        <CardHeader>
          <CardTitle className="text-lg">Revenue by Surgeon</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (surgeonStats.length === 0) {
    return (
      <Card className="card-premium">
        <CardHeader>
          <CardTitle className="text-lg">Revenue by Surgeon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No paid transactions yet
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-premium">
      <CardHeader>
        <CardTitle className="text-lg">Revenue by Surgeon</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={surgeonStats}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={80}
                paddingAngle={2}
                dataKey="amount"
                nameKey="name"
                label={({ name, percent }) =>
                  `${name.split(" ")[0]} (${(percent * 100).toFixed(0)}%)`
                }
                labelLine={false}
              >
                {surgeonStats.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [
                  formatAmount(value),
                  name,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 space-y-2">
          {surgeonStats.slice(0, 5).map((surgeon, index) => (
            <div
              key={surgeon.name}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="text-foreground">{surgeon.name}</span>
              </div>
              <div className="text-right">
                <span className="font-medium text-foreground">
                  {formatAmount(surgeon.amount)}
                </span>
                <span className="text-muted-foreground ml-2">
                  ({surgeon.count} paid)
                </span>
              </div>
            </div>
          ))}
          {surgeonStats.length > 5 && (
            <p className="text-xs text-muted-foreground text-center">
              + {surgeonStats.length - 5} more surgeons
            </p>
          )}
        </div>
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-medium text-foreground">
              {formatAmount(totalPaid)} ({totalCount} transactions)
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
