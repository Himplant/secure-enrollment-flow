import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { format, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, differenceInDays, startOfDay, startOfWeek, startOfMonth } from "date-fns";

interface Enrollment {
  status: string;
  amount_cents: number;
  created_at: string;
  paid_at: string | null;
}

interface EnrollmentTrendChartProps {
  enrollments: Enrollment[];
  isLoading: boolean;
  dateFrom?: Date;
  dateTo?: Date;
}

export function EnrollmentTrendChart({ enrollments, isLoading, dateFrom, dateTo }: EnrollmentTrendChartProps) {
  const chartData = useMemo(() => {
    if (!enrollments.length) return [];

    const from = dateFrom || new Date(Math.min(...enrollments.map(e => new Date(e.created_at).getTime())));
    const to = dateTo || new Date();
    const daysDiff = differenceInDays(to, from);

    // Choose granularity based on range
    let intervals: Date[];
    let formatStr: string;
    let bucketFn: (d: Date) => string;

    if (daysDiff <= 31) {
      intervals = eachDayOfInterval({ start: from, end: to });
      formatStr = "MMM d";
      bucketFn = (d) => format(startOfDay(d), "yyyy-MM-dd");
    } else if (daysDiff <= 180) {
      intervals = eachWeekOfInterval({ start: from, end: to });
      formatStr = "MMM d";
      bucketFn = (d) => format(startOfWeek(d), "yyyy-MM-dd");
    } else {
      intervals = eachMonthOfInterval({ start: from, end: to });
      formatStr = "MMM yyyy";
      bucketFn = (d) => format(startOfMonth(d), "yyyy-MM");
    }

    // Build buckets
    const buckets = new Map<string, { created: number; paid: number; revenue: number }>();
    intervals.forEach((d) => {
      const key = daysDiff <= 180 ? format(d, "yyyy-MM-dd") : format(d, "yyyy-MM");
      buckets.set(key, { created: 0, paid: 0, revenue: 0 });
    });

    enrollments.forEach((e) => {
      const createdKey = bucketFn(new Date(e.created_at));
      if (buckets.has(createdKey)) {
        buckets.get(createdKey)!.created += 1;
      }
      if (e.status === "paid" && e.paid_at) {
        const paidKey = bucketFn(new Date(e.paid_at));
        if (buckets.has(paidKey)) {
          buckets.get(paidKey)!.paid += 1;
          buckets.get(paidKey)!.revenue += e.amount_cents / 100;
        }
      }
    });

    return Array.from(buckets.entries()).map(([key, val]) => ({
      date: key,
      label: format(new Date(key), formatStr),
      created: val.created,
      paid: val.paid,
      revenue: val.revenue,
    }));
  }, [enrollments, dateFrom, dateTo]);

  if (isLoading) {
    return (
      <Card className="card-premium">
        <CardHeader>
          <CardTitle className="text-lg">Enrollment Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[280px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!chartData.length) {
    return (
      <Card className="card-premium">
        <CardHeader>
          <CardTitle className="text-lg">Enrollment Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-12">
            No enrollment data for this period
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-premium">
      <CardHeader>
        <CardTitle className="text-lg">Enrollment Trends</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="gradCreated" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradPaid" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(value: number, name: string) => {
                  if (name === "revenue") return [`$${value.toLocaleString()}`, "Revenue"];
                  return [value, name === "created" ? "Created" : "Paid"];
                }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "12px" }}
              />
              <Area
                type="monotone"
                dataKey="created"
                name="Created"
                stroke="hsl(var(--primary))"
                fill="url(#gradCreated)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="paid"
                name="Paid"
                stroke="hsl(var(--success))"
                fill="url(#gradPaid)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
