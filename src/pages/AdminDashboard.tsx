import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  MoreHorizontal,
  Eye,
  Copy,
  Send,
  XCircle,
  LogOut,
  Settings,
  Loader2,
  RefreshCw,
  Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { UserManagement } from "@/components/admin/UserManagement";
import { CreateEnrollmentModal } from "@/components/admin/CreateEnrollmentModal";
import { RegenerateLinkModal } from "@/components/admin/RegenerateLinkModal";
import { DashboardStats } from "@/components/admin/DashboardStats";
import { EnrollmentFiltersComponent, EnrollmentFilters } from "@/components/admin/EnrollmentFilters";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type EnrollmentStatus = 'created' | 'sent' | 'opened' | 'processing' | 'paid' | 'failed' | 'expired' | 'canceled';

interface Enrollment {
  id: string;
  token_last4: string;
  patient_name: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  amount_cents: number;
  status: EnrollmentStatus;
  payment_method_type: string | null;
  created_at: string | null;
  expires_at: string;
}

const defaultFilters: EnrollmentFilters = {
  search: "",
  status: "all",
  paymentMethod: "all",
  amountMin: "",
  amountMax: "",
  dateFrom: undefined,
  dateTo: undefined,
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, adminUser, signOut } = useAdminAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<EnrollmentFilters>(defaultFilters);
  const [activeTab, setActiveTab] = useState("enrollments");
  const [regenerateEnrollment, setRegenerateEnrollment] = useState<Enrollment | null>(null);
  const [createForPatient, setCreateForPatient] = useState<{ patient_name: string; patient_email: string | null; patient_phone: string | null } | null>(null);

  // Fetch enrollments with server-side filters where possible
  const { data: enrollments, isLoading: enrollmentsLoading, refetch } = useQuery({
    queryKey: ["enrollments", filters.status, filters.paymentMethod, filters.dateFrom?.toISOString(), filters.dateTo?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("enrollments")
        .select("id, token_last4, patient_name, patient_email, patient_phone, amount_cents, status, payment_method_type, created_at, expires_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (filters.status !== "all") {
        query = query.eq("status", filters.status as EnrollmentStatus);
      }

      if (filters.paymentMethod !== "all") {
        query = query.eq("payment_method_type", filters.paymentMethod as "card" | "ach");
      }

      if (filters.dateFrom) {
        query = query.gte("created_at", filters.dateFrom.toISOString());
      }

      if (filters.dateTo) {
        const endOfDay = new Date(filters.dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        query = query.lte("created_at", endOfDay.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Enrollment[];
    },
  });

  // Client-side filtering for search and amount range
  const filteredEnrollments = useMemo(() => {
    let result = enrollments || [];

    // Search filter
    if (filters.search) {
      const search = filters.search.toLowerCase();
      result = result.filter((e) =>
        (e.patient_name?.toLowerCase() || "").includes(search) ||
        (e.patient_email?.toLowerCase() || "").includes(search) ||
        e.token_last4.includes(search)
      );
    }

    // Amount range filters
    if (filters.amountMin) {
      const minCents = parseFloat(filters.amountMin) * 100;
      result = result.filter((e) => e.amount_cents >= minCents);
    }

    if (filters.amountMax) {
      const maxCents = parseFloat(filters.amountMax) * 100;
      result = result.filter((e) => e.amount_cents <= maxCents);
    }

    return result;
  }, [enrollments, filters.search, filters.amountMin, filters.amountMax]);

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/admin/login", { replace: true });
  };

  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    queryClient.invalidateQueries({ queryKey: ["enrollment-stats"] });
    toast({
      title: "Refreshed",
      description: "Data has been refreshed",
    });
  };

  const handleCopyLink = (tokenLast4: string) => {
    const baseUrl = window.location.origin;
    navigator.clipboard.writeText(`${baseUrl}/enroll/****${tokenLast4}`);
    toast({
      title: "Link copied",
      description: "Enrollment link copied to clipboard (partial token shown)",
    });
  };

  const handleViewDetails = (enrollment: Enrollment) => {
    toast({
      title: "Enrollment Details",
      description: `Viewing ${enrollment.patient_name || "Unknown"} - ${enrollment.status}`,
    });
  };

  const handleResendLink = (enrollment: Enrollment) => {
    toast({
      title: "Resend Link",
      description: `Resend functionality for ${enrollment.patient_email || "Unknown"} - coming soon`,
    });
  };

  const handleRegenerateLink = (enrollment: Enrollment) => {
    // Only allow regeneration for expired, canceled, or failed enrollments
    const regeneratableStatuses = ['expired', 'canceled', 'failed'];
    if (!regeneratableStatuses.includes(enrollment.status)) {
      toast({
        title: "Cannot regenerate",
        description: `Only expired, canceled, or failed enrollments can be regenerated. Current status: ${enrollment.status}`,
        variant: "destructive",
      });
      return;
    }
    setRegenerateEnrollment(enrollment);
  };

  const handleCreateAnotherForPatient = (enrollment: Enrollment) => {
    setCreateForPatient({
      patient_name: enrollment.patient_name || "",
      patient_email: enrollment.patient_email,
      patient_phone: enrollment.patient_phone,
    });
  };

  const handleCancelEnrollment = async (enrollment: Enrollment) => {
    toast({
      title: "Cancel Enrollment",
      description: `Cancel functionality for ${enrollment.id} - coming soon`,
      variant: "destructive",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                Enrollment Dashboard
              </h1>
              <p className="text-sm text-muted-foreground">
                Manage patient enrollments and payments
              </p>
            </div>
            <div className="flex items-center gap-3">
              <CreateEnrollmentModal />
              <span className="text-sm text-muted-foreground hidden sm:block">
                {user?.email}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    Role: {adminUser?.role || "loading..."}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Stats cards */}
        <div className="mb-8">
          <DashboardStats dateFrom={filters.dateFrom} dateTo={filters.dateTo} />
        </div>

        {/* Tabs for Enrollments and User Management */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="enrollments">Enrollments</TabsTrigger>
            {adminUser?.role === "admin" && (
              <TabsTrigger value="users">User Management</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="enrollments" className="space-y-6">
            {/* Filters */}
            <Card className="card-premium">
              <div className="p-4">
                <EnrollmentFiltersComponent
                  filters={filters}
                  onChange={setFilters}
                  onRefresh={handleRefresh}
                />
              </div>
            </Card>

            {/* Enrollments table */}
            <Card className="card-premium overflow-hidden">
              <CardHeader className="border-b border-border bg-muted/30">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    Enrollments
                    {filteredEnrollments.length > 0 && (
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        ({filteredEnrollments.length} results)
                      </span>
                    )}
                  </CardTitle>
                </div>
              </CardHeader>
              <div className="overflow-x-auto">
                {enrollmentsLoading ? (
                  <div className="flex justify-center items-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredEnrollments.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No enrollments found
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Patient</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Payment Method</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEnrollments.map((enrollment) => (
                        <TableRow key={enrollment.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-foreground">
                                {enrollment.patient_name || "Unknown"}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {enrollment.patient_email || "No email"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">
                            {formatAmount(enrollment.amount_cents)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={enrollment.status} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {enrollment.payment_method_type === 'card' ? 'Card' : 
                             enrollment.payment_method_type === 'ach' ? 'ACH' : '—'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {enrollment.created_at ? format(new Date(enrollment.created_at), 'MMM d, yyyy') : '—'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(enrollment.expires_at), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleViewDetails(enrollment)}>
                                  <Eye className="h-4 w-4 mr-2" />
                                  View Details
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleCopyLink(enrollment.token_last4)}>
                                  <Copy className="h-4 w-4 mr-2" />
                                  Copy Link
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleResendLink(enrollment)}>
                                  <Send className="h-4 w-4 mr-2" />
                                  Resend Link
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleCreateAnotherForPatient(enrollment)}>
                                  <Plus className="h-4 w-4 mr-2" />
                                  Create Another for Patient
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => handleRegenerateLink(enrollment)}
                                  disabled={!['expired', 'canceled', 'failed'].includes(enrollment.status)}
                                >
                                  <RefreshCw className="h-4 w-4 mr-2" />
                                  Regenerate Link
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  className="text-destructive"
                                  onClick={() => handleCancelEnrollment(enrollment)}
                                >
                                  <XCircle className="h-4 w-4 mr-2" />
                                  Cancel Enrollment
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </Card>
          </TabsContent>

          {adminUser?.role === "admin" && (
            <TabsContent value="users">
              <UserManagement />
            </TabsContent>
          )}
        </Tabs>

        {/* Regenerate Link Modal */}
        {regenerateEnrollment && (
          <RegenerateLinkModal
            isOpen={!!regenerateEnrollment}
            onClose={() => setRegenerateEnrollment(null)}
            enrollment={regenerateEnrollment}
          />
        )}

        {/* Create Another for Patient Modal */}
        <CreateEnrollmentModal
          prefillData={createForPatient}
          isOpen={!!createForPatient}
          onOpenChange={(open) => !open && setCreateForPatient(null)}
        />
      </main>
    </div>
  );
}
