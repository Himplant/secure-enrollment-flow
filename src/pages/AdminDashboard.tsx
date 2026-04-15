import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  LogOut, Settings, RefreshCw, Users, Receipt, FileText, UserCog, Shield, DollarSign
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
import { ConsultantDistributionCard } from "@/components/admin/ConsultantDistributionCard";
import { ConsultantTrendChart } from "@/components/admin/ConsultantTrendChart";
import { AuditLogTab } from "@/components/admin/AuditLogTab";
import { CreditsTab } from "@/components/admin/CreditsTab";
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

  // Global analytics filters
  const [analyticsSurgeonFilter, setAnalyticsSurgeonFilter] = useState<string>("all");
  const [analyticsConsultantFilter, setAnalyticsConsultantFilter] = useState<string>("all");

  // Fetch surgeons for filter
  const { data: surgeonsList = [] } = useQuery({
    queryKey: ["surgeons-analytics-filter"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surgeons")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Single query for analytics enrollments (includes owner_name + patient surgeon)
  const { data: rawPlatformEnrollments = [], isLoading: statsLoading } = useQuery({
    queryKey: ["analytics-enrollments", dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("enrollments")
        .select(`
          status, amount_cents, created_at, paid_at, owner_name,
          patients!enrollments_patient_id_fkey (
            surgeon_id,
            surgeon:surgeons(id, name)
          )
        `);

      if (dateRange.from) {
        query = query.gte("created_at", dateRange.from.toISOString());
      }
      if (dateRange.to) {
        query = query.lte("created_at", dateRange.to.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((e: any) => ({
        ...e,
        surgeon_name: e.patients?.surgeon?.name || null,
        surgeon_id: e.patients?.surgeon_id || null,
      }));
    },
  });

  // Query imported credits to merge into analytics
  const { data: importedCredits = [] } = useQuery({
    queryKey: ["analytics-imported-credits", dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("surgeon_credits")
        .select("id, surgeon_name, surgeon_id, patient_name, consultant_email, enrollment_date, credit_amount, credit_status")
        .eq("source", "import");

      if (dateRange.from) {
        query = query.gte("enrollment_date", dateRange.from.toISOString().split("T")[0]);
      }
      if (dateRange.to) {
        query = query.lte("enrollment_date", dateRange.to.toISOString().split("T")[0]);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Merge platform enrollments with imported credits for analytics
  const rawEnrollments = useMemo(() => {
    const platform = rawPlatformEnrollments;
    // Convert imported credits to enrollment-like objects
    const imported = importedCredits.map((c: any) => ({
      status: "paid" as const,
      amount_cents: 50000, // Each enrollment is $500 flat
      created_at: c.enrollment_date ? `${c.enrollment_date}T00:00:00Z` : c.created_at,
      paid_at: c.enrollment_date ? `${c.enrollment_date}T00:00:00Z` : null,
      owner_name: c.consultant_email ? c.consultant_email.split("@")[0] : null,
      surgeon_name: c.surgeon_name || null,
      surgeon_id: c.surgeon_id || null,
    }));
    return [...platform, ...imported];
  }, [rawPlatformEnrollments, importedCredits]);

  // Extract unique consultant names for filter
  const consultantNames = useMemo(() => {
    const names = new Set<string>();
    rawEnrollments.forEach((e: any) => { if (e.owner_name) names.add(e.owner_name); });
    return Array.from(names).sort();
  }, [rawEnrollments]);

  // Apply global filters to enrollments
  const enrollments = useMemo(() => {
    let result = rawEnrollments;

    if (analyticsSurgeonFilter !== "all") {
      if (analyticsSurgeonFilter === "unassigned") {
        result = result.filter((e: any) => !e.surgeon_id);
      } else {
        result = result.filter((e: any) => e.surgeon_id === analyticsSurgeonFilter);
      }
    }

    if (analyticsConsultantFilter !== "all") {
      if (analyticsConsultantFilter === "unassigned") {
        result = result.filter((e: any) => !e.owner_name);
      } else {
        result = result.filter((e: any) => e.owner_name === analyticsConsultantFilter);
      }
    }

    return result;
  }, [rawEnrollments, analyticsSurgeonFilter, analyticsConsultantFilter]);

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
    queryClient.invalidateQueries({ queryKey: ["analytics-imported-credits"] });
    queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    queryClient.invalidateQueries({ queryKey: ["surgeon-credits"] });
    queryClient.invalidateQueries({ queryKey: ["policies"] });
    queryClient.invalidateQueries({ queryKey: ["surgeons"] });
    queryClient.invalidateQueries({ queryKey: ["surgeons-management"] });
    queryClient.invalidateQueries({ queryKey: ["surgeon-distribution"] });
    queryClient.invalidateQueries({ queryKey: ["consultant-distribution"] });
    queryClient.invalidateQueries({ queryKey: ["surgeons-analytics-filter"] });
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
          {/* Date filter + global surgeon/consultant filters */}
          <div className="space-y-3">
            <AnalyticsDateFilter
              dateRange={dateRange}
              preset={preset}
              onPresetChange={setPreset}
              onDateRangeChange={setDateRange}
            />
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">Filter by:</span>
              <Select value={analyticsSurgeonFilter} onValueChange={setAnalyticsSurgeonFilter}>
                <SelectTrigger className="w-[180px] h-8 text-xs">
                  <SelectValue placeholder="All Surgeons" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Surgeons</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {surgeonsList.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={analyticsConsultantFilter} onValueChange={setAnalyticsConsultantFilter}>
                <SelectTrigger className="w-[180px] h-8 text-xs">
                  <SelectValue placeholder="All Consultants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Consultants</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {consultantNames.map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(analyticsSurgeonFilter !== "all" || analyticsConsultantFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => { setAnalyticsSurgeonFilter("all"); setAnalyticsConsultantFilter("all"); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>

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

          {/* Consultant charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ConsultantTrendChart dateFrom={dateRange.from} dateTo={dateRange.to} />
            <ConsultantDistributionCard />
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="patients" className="gap-2"><Users className="h-4 w-4" />Patients</TabsTrigger>
            <TabsTrigger value="transactions" className="gap-2"><Receipt className="h-4 w-4" />Transactions</TabsTrigger>
            <TabsTrigger value="policies" className="gap-2"><FileText className="h-4 w-4" />Policies</TabsTrigger>
            <TabsTrigger value="surgeons" className="gap-2"><UserCog className="h-4 w-4" />Surgeons</TabsTrigger>
            <TabsTrigger value="credits" className="gap-2"><DollarSign className="h-4 w-4" />Credits</TabsTrigger>
            <TabsTrigger value="audit" className="gap-2"><Shield className="h-4 w-4" />Audit Log</TabsTrigger>
            {(adminUser?.role === "admin" || adminUser?.role === "super_admin") && (
              <TabsTrigger value="users" className="gap-2"><Settings className="h-4 w-4" />User Management</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="patients"><PatientsTab /></TabsContent>
          <TabsContent value="transactions"><TransactionsTab /></TabsContent>
          <TabsContent value="policies"><PoliciesTab /></TabsContent>
          <TabsContent value="surgeons"><SurgeonManagement /></TabsContent>
          <TabsContent value="credits"><CreditsTab /></TabsContent>
          <TabsContent value="audit"><AuditLogTab /></TabsContent>
          {(adminUser?.role === "admin" || adminUser?.role === "super_admin") && (
            <TabsContent value="users"><UserManagement /></TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}
