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
  const { data: rawPlatformEnrollments = [], isLoading: statsLoading, refetch: refetchAnalytics, isFetching: analyticsFetching } = useQuery({
    queryKey: ["analytics-enrollments", dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("enrollments")
        .select(`
          status, amount_cents, created_at, paid_at, owner_name, owner_email, owner_zoho_id,
          patients!enrollments_patient_id_fkey (
            surgeon_id,
            surgeon:surgeons(id, name)
          )
        `);

      if (dateRange.from) {
        query = query.gte("created_at", dateRange.from.toISOString());
      }
      if (dateRange.to) {
        // Extend "to" through end of day so today's records are included
        const inclusiveTo = new Date(dateRange.to);
        inclusiveTo.setHours(23, 59, 59, 999);
        query = query.lte("created_at", inclusiveTo.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((e: any) => ({
        ...e,
        surgeon_name: e.patients?.surgeon?.name || null,
        surgeon_id: e.patients?.surgeon_id || null,
      }));
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchInterval: 60_000, // auto-refresh every 60s
  });

  // Consultant identity: Zoho CRM is the source of truth. Group by stable key
  // (Zoho owner id > owner email > lowercased name) and use the latest observed
  // name per key so CRM renames never create a duplicate.
  const getConsultantKey = (e: any): string | null => {
    if (e.owner_zoho_id) return `zid:${e.owner_zoho_id}`;
    if (e.owner_email) return `em:${String(e.owner_email).toLowerCase().trim()}`;
    if (e.owner_name) return `nm:${String(e.owner_name).toLowerCase().trim()}`;
    return null;
  };

  // For each stable consultant key, pick the most recently seen owner_name so
  // a name change in the CRM immediately propagates and never creates a duplicate row.
  const consultantLatestName = useMemo(() => {
    const latest = new Map<string, { name: string; ts: number }>();
    for (const e of rawPlatformEnrollments as any[]) {
      const key = getConsultantKey(e);
      if (!key || !e.owner_name) continue;
      const ts = new Date(e.paid_at || e.created_at || 0).getTime();
      const prev = latest.get(key);
      if (!prev || ts >= prev.ts) latest.set(key, { name: e.owner_name, ts });
    }
    return latest;
  }, [rawPlatformEnrollments]);

  const resolveConsultantName = (row: any): string | null => {
    const key = getConsultantKey(row);
    if (key) {
      const latest = consultantLatestName.get(key);
      if (latest) return latest.name;
      // Key exists (email/id) but no name yet — derive from email prefix.
      if (key.startsWith("em:")) {
        const prefix = key.slice(3).split("@")[0];
        return prefix.charAt(0).toUpperCase() + prefix.slice(1);
      }
    }
    return row.owner_name || null;
  };

  // Since all paid patients now have enrollment records, use enrollments directly.
  // Rewrite owner_name to the latest canonical name so downstream grouping dedupes.
  const rawEnrollments = useMemo(() => {
    return (rawPlatformEnrollments as any[]).map((e: any) => ({
      ...e,
      owner_name: resolveConsultantName(e),
      _consultantKey: getConsultantKey(e),
    }));
  }, [rawPlatformEnrollments, consultantLatestName]);

  // Extract unique consultants for filter — dedupe by stable key, show latest name.
  const consultantNames = useMemo(() => {
    const byKey = new Map<string, string>();
    rawEnrollments.forEach((e: any) => {
      if (e._consultantKey && e.owner_name) byKey.set(e._consultantKey, e.owner_name);
    });
    return Array.from(new Set(byKey.values())).sort();
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
    queryClient.invalidateQueries({ queryKey: ["analytics-enrollments"] });
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <AnalyticsDateFilter
                dateRange={dateRange}
                preset={preset}
                onPresetChange={setPreset}
                onDateRangeChange={setDateRange}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => {
                  refetchAnalytics();
                  queryClient.invalidateQueries({ queryKey: ["analytics-enrollments"] });
                }}
                disabled={analyticsFetching}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${analyticsFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
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
            <SurgeonTrendChart enrollments={enrollments} isLoading={statsLoading} dateFrom={dateRange.from} dateTo={dateRange.to} />
            <SurgeonDistributionCard enrollments={enrollments} isLoading={statsLoading} />
          </div>

          {/* Consultant charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ConsultantTrendChart enrollments={enrollments} isLoading={statsLoading} dateFrom={dateRange.from} dateTo={dateRange.to} />
            <ConsultantDistributionCard enrollments={enrollments} isLoading={statsLoading} />
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
          <TabsContent value="credits"><CreditsTab adminRole={adminUser?.role || "viewer"} /></TabsContent>
          <TabsContent value="audit"><AuditLogTab /></TabsContent>
          {(adminUser?.role === "admin" || adminUser?.role === "super_admin") && (
            <TabsContent value="users"><UserManagement /></TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}
