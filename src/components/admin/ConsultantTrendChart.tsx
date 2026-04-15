import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { format, eachMonthOfInterval, eachWeekOfInterval, eachDayOfInterval, differenceInDays, startOfDay, startOfWeek, startOfMonth } from "date-fns";

const COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#a855f7",
  "#ef4444", "#06b6d4", "#ec4899", "#84cc16",
];

interface ConsultantTrendChartProps {
  enrollments: any[];
  isLoading: boolean;
  dateFrom?: Date;
  dateTo?: Date;
}

export function ConsultantTrendChart({ enrollments, isLoading, dateFrom, dateTo }: ConsultantTrendChartProps) {
  const { chartData, consultantNames } = useMemo(() => {
    if (!enrollments?.length) return { chartData: [], consultantNames: [] };

    const from = dateFrom || new Date(Math.min(...enrollments.map((e: any) => new Date(e.created_at).getTime())));
    const to = dateTo || new Date();
    const daysDiff = differenceInDays(to, from);

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

    const nameSet = new Set<string>();
    const buckets = new Map<string, Record<string, number>>();

    intervals.forEach((d) => {
      const key = daysDiff <= 180 ? format(d, "yyyy-MM-dd") : format(d, "yyyy-MM");
      buckets.set(key, {});
    });

    enrollments.forEach((e: any) => {
      const name = e.owner_name || "Unassigned";
      nameSet.add(name);
      const key = bucketFn(new Date(e.created_at));
      if (buckets.has(key)) {
        const bucket = buckets.get(key)!;
        bucket[name] = (bucket[name] || 0) + 1;
      }
    });

    const names = Array.from(nameSet).sort();
    const data = Array.from(buckets.entries()).map(([key, counts]) => ({
      date: key,
      label: format(new Date(key), formatStr),
      ...counts,
    }));

    return { chartData: data, consultantNames: names };
  }, [enrollments, dateFrom, dateTo]);

  if (isLoading) {
    return (
      <Card className="card-premium">
        <CardHeader><CardTitle className="text-lg">Enrollments by Consultant</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-[280px] w-full" /></CardContent>
      </Card>
    );
  }

  if (!chartData.length) {
    return (
      <Card className="card-premium">
        <CardHeader><CardTitle className="text-lg">Enrollments by Consultant</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground text-center py-12">No data for this period</p></CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-premium">
      <CardHeader><CardTitle className="text-lg">Enrollments by Consultant</CardTitle></CardHeader>
      <CardContent>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
              {consultantNames.map((name, i) => (
                <Bar key={name} dataKey={name} stackId="a" fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
