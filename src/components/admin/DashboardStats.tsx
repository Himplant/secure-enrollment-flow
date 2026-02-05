import { useQuery } from "@tanstack/react-query";
import { Users, DollarSign, Clock, TrendingUp, AlertCircle, CheckCircle, XCircle, Send, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

interface StatsProps {
  dateFrom?: Date;
  dateTo?: Date;
}

interface EnrollmentStats {
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

export function DashboardStats({ dateFrom, dateTo }: StatsProps) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["enrollment-stats", dateFrom?.toISOString(), dateTo?.toISOString()],
    queryFn: async (): Promise<EnrollmentStats> => {
      let query = supabase
        .from("enrollments")
        .select("status, amount_cents, created_at");

      if (dateFrom) {
        query = query.gte("created_at", dateFrom.toISOString());
      }
      if (dateTo) {
        query = query.lte("created_at", dateTo.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      const enrollments = data || [];
      
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

      // Conversion rate: paid / (paid + expired + failed)
      const completed = paid + expired + failed;
      const conversionRate = completed > 0 ? (paid / completed) * 100 : 0;

      return {
        total,
        created,
        sent,
        opened,
        paid,
        processing,
        pending,
        expired,
        failed,
        canceled,
        totalPaidAmount,
        totalProcessingAmount,
        conversionRate,
      };
    },
  });

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(cents / 100);
  };

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

  // Status breakdown for second row
  const statusBreakdown = [
    { label: "Created", count: stats?.created ?? 0, color: "bg-muted" },
    { label: "Sent", count: stats?.sent ?? 0, color: "bg-blue-500/20" },
    { label: "Opened", count: stats?.opened ?? 0, color: "bg-purple-500/20" },
    { label: "Processing", count: stats?.processing ?? 0, color: "bg-warning/20" },
    { label: "Paid", count: stats?.paid ?? 0, color: "bg-success/20" },
    { label: "Failed", count: stats?.failed ?? 0, color: "bg-destructive/20" },
    { label: "Expired", count: stats?.expired ?? 0, color: "bg-muted" },
    { label: "Canceled", count: stats?.canceled ?? 0, color: "bg-muted" },
  ];

  if (isLoading) {
    return (
      <div className="space-y-4">
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
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main stat cards */}
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

      {/* Status breakdown */}
      <Card className="card-premium">
        <CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground mb-3">Transactions by Status</p>
          <div className="flex flex-wrap gap-3">
            {statusBreakdown.map((status) => (
              <div 
                key={status.label} 
                className={`${status.color} px-3 py-2 rounded-lg flex items-center gap-2`}
              >
                <span className="text-sm text-foreground">{status.label}</span>
                <span className="text-sm font-bold text-foreground">{status.count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}