import { useMemo } from "react";
import { Users, DollarSign, Clock, TrendingUp, CheckCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Enrollment {
  status: string;
  amount_cents: number;
  created_at: string;
  paid_at: string | null;
}

export interface EnrollmentStats {
  total: number;
  created: number;
  sent: number;
  opened: number;
  paid: number;
  processing: number;
  pending: number;
  expired: number;
  failed: number;
  canceled: number;
  totalPaidAmount: number;
  totalProcessingAmount: number;
  conversionRate: number;
}

export function computeStats(enrollments: Enrollment[]): EnrollmentStats {
  const total = enrollments.length;
  const created = enrollments.filter(e => e.status === "created").length;
  const sent = enrollments.filter(e => e.status === "sent").length;
  const opened = enrollments.filter(e => e.status === "opened").length;
  const paid = enrollments.filter(e => e.status === "paid").length;
  const processing = enrollments.filter(e => e.status === "processing").length;
  const pending = enrollments.filter(e => ["created", "sent", "opened"].includes(e.status)).length;
  const expired = enrollments.filter(e => e.status === "expired").length;
  const failed = enrollments.filter(e => e.status === "failed").length;
  const canceled = enrollments.filter(e => e.status === "canceled").length;

  const totalPaidAmount = enrollments
    .filter(e => e.status === "paid")
    .reduce((sum, e) => sum + e.amount_cents, 0);

  const totalProcessingAmount = enrollments
    .filter(e => e.status === "processing")
    .reduce((sum, e) => sum + e.amount_cents, 0);

  const completed = paid + expired + failed;
  const conversionRate = completed > 0 ? (paid / completed) * 100 : 0;

  return { total, created, sent, opened, paid, processing, pending, expired, failed, canceled, totalPaidAmount, totalProcessingAmount, conversionRate };
}

interface DashboardStatsProps {
  stats: EnrollmentStats | null;
  isLoading: boolean;
}

export function DashboardStats({ stats, isLoading }: DashboardStatsProps) {
  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(cents / 100);

  const statCards = [
    {
      title: "Total Enrollments",
      value: stats?.total ?? 0,
      subtitle: `${stats?.pending ?? 0} pending`,
      icon: Users,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "Paid",
      value: formatCurrency(stats?.totalPaidAmount ?? 0),
      subtitle: `${stats?.paid ?? 0} enrollments`,
      icon: CheckCircle,
      color: "text-success",
      bgColor: "bg-success/10",
    },
    {
      title: "Processing (ACH)",
      value: formatCurrency(stats?.totalProcessingAmount ?? 0),
      subtitle: `${stats?.processing ?? 0} pending`,
      icon: Clock,
      color: "text-warning",
      bgColor: "bg-warning/10",
    },
    {
      title: "Conversion Rate",
      value: `${(stats?.conversionRate ?? 0).toFixed(1)}%`,
      subtitle: `${stats?.failed ?? 0} failed, ${stats?.expired ?? 0} expired`,
      icon: TrendingUp,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="card-premium">
            <CardContent className="p-6">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-32 mb-1" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {statCards.map((stat) => (
        <Card key={stat.title} className="card-premium">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">{stat.title}</p>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.subtitle}</p>
              </div>
              <div className={`w-10 h-10 rounded-lg ${stat.bgColor} flex items-center justify-center`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
