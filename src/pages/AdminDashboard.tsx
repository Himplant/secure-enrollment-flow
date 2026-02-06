import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  LogOut, Settings, RefreshCw, Users, Receipt, FileText, UserCog
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { UserManagement } from "@/components/admin/UserManagement";
import { DashboardStats, computeStats } from "@/components/admin/DashboardStats";
import { SurgeonDistributionCard } from "@/components/admin/SurgeonDistributionCard";
import { EnrollmentTrendChart } from "@/components/admin/EnrollmentTrendChart";
import { StatusFunnelChart } from "@/components/admin/StatusFunnelChart";
import { SurgeonTrendChart } from "@/components/admin/SurgeonTrendChart";
import { PeriodComparisonCard } from "@/components/admin/PeriodComparisonCard";
import { AnalyticsDateFilter, getDateRangeForPreset, type DatePreset } from "@/components/admin/AnalyticsDateFilter";
import { PatientsTab } from "@/components/admin/PatientsTab";
import { TransactionsTab } from "@/components/admin/TransactionsTab";
import { PoliciesTab } from "@/components/admin/PoliciesTab";
import { SurgeonManagement } from "@/components/admin/SurgeonManagement";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, adminUser, signOut } = useAdminAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("patients");

  // Analytics date filter state
  const [preset, setPreset] = useState<DatePreset>("30d");
  const [dateRange, setDateRange] = useState(getDateRangeForPreset("30d"));

  // Single query for analytics enrollments
  const { data: enrollments = [], isLoading: statsLoading } = useQuery({
    queryKey: ["analytics-enrollments", dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("enrollments")
        .select("status, amount_cents, created_at, paid_at");

      if (dateRange.from) {
        query = query.gte("created_at", dateRange.from.toISOString());
      }
      if (dateRange.to) {
        query = query.lte("created_at", dateRange.to.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const stats = useMemo(() => (enrollments.length ? computeStats(enrollments) : null), [enrollments]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/admin/login", { replace: true });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["patients"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    queryClient.invalidateQueries({ queryKey: ["analytics-enrollments"] });
    queryClient.invalidateQueries({ queryKey: ["policies"] });
    queryClient.invalidateQueries({ queryKey: ["surgeons"] });
    queryClient.invalidateQueries({ queryKey: ["surgeons-management"] });
    queryClient.invalidateQueries({ queryKey: ["surgeon-distribution"] });
    toast({ title: "Refreshed", description: "Data has been refreshed" });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Enrollment Dashboard</h1>
              <p className="text-sm text-muted-foreground">Manage patients, enrollments and payments</p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4" />
              </Button>
           <p className="text-sm text-muted-foreground hidden sm:block">{user?.email}</p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon"><Settings className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    Role: {adminUser?.role || "loading..."}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="h-4 w-4 mr-2" />Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Analytics section */}
        <div className="mb-8 space-y-6">
          {/* Date filter */}
          <AnalyticsDateFilter
            dateRange={dateRange}
            preset={preset}
            onPresetChange={setPreset}
            onDateRangeChange={setDateRange}
          />

          {/* KPI cards */}
          <DashboardStats stats={stats} isLoading={statsLoading} />

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <EnrollmentTrendChart
              enrollments={enrollments}
              isLoading={statsLoading}
              dateFrom={dateRange.from}
              dateTo={dateRange.to}
            />
            <StatusFunnelChart stats={stats} isLoading={statsLoading} />
          </div>

          {/* Period comparison */}
          <PeriodComparisonCard
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
            currentStats={stats}
            isLoading={statsLoading}
          />

          {/* Surgeon charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SurgeonTrendChart dateFrom={dateRange.from} dateTo={dateRange.to} />
            <SurgeonDistributionCard />
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="patients" className="gap-2"><Users className="h-4 w-4" />Patients</TabsTrigger>
            <TabsTrigger value="transactions" className="gap-2"><Receipt className="h-4 w-4" />Transactions</TabsTrigger>
            <TabsTrigger value="policies" className="gap-2"><FileText className="h-4 w-4" />Policies</TabsTrigger>
            <TabsTrigger value="surgeons" className="gap-2"><UserCog className="h-4 w-4" />Surgeons</TabsTrigger>
            {(adminUser?.role === "admin" || adminUser?.role === "super_admin") && (
              <TabsTrigger value="users" className="gap-2"><Settings className="h-4 w-4" />User Management</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="patients"><PatientsTab /></TabsContent>
          <TabsContent value="transactions"><TransactionsTab /></TabsContent>
          <TabsContent value="policies"><PoliciesTab /></TabsContent>
          <TabsContent value="surgeons"><SurgeonManagement /></TabsContent>
          {(adminUser?.role === "admin" || adminUser?.role === "super_admin") && (
            <TabsContent value="users"><UserManagement /></TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}
