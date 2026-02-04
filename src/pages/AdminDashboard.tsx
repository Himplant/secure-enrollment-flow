import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  Search, 
  Filter, 
  RefreshCw, 
  MoreHorizontal,
  Eye,
  Copy,
  Send,
  XCircle,
  Clock,
  Users,
  DollarSign,
  TrendingUp,
  LogOut,
  Settings,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { UserManagement } from "@/components/admin/UserManagement";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const stats = [
  {
    title: "Total Enrollments",
    value: "156",
    change: "+12%",
    icon: Users,
  },
  {
    title: "Paid This Month",
    value: "$45,230",
    change: "+8%",
    icon: DollarSign,
  },
  {
    title: "Processing (ACH)",
    value: "3",
    change: "$8,500",
    icon: Clock,
  },
  {
    title: "Conversion Rate",
    value: "78%",
    change: "+5%",
    icon: TrendingUp,
  },
];

type EnrollmentStatus = 'created' | 'sent' | 'opened' | 'processing' | 'paid' | 'failed' | 'expired' | 'canceled';

interface Enrollment {
  id: string;
  token_last4: string;
  patient_name: string | null;
  patient_email: string | null;
  amount_cents: number;
  status: EnrollmentStatus;
  payment_method_type: string | null;
  created_at: string | null;
  expires_at: string;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, adminUser, signOut } = useAdminAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("enrollments");

  // Fetch real enrollments from database
  const { data: enrollments, isLoading: enrollmentsLoading, refetch } = useQuery({
    queryKey: ["enrollments", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("enrollments")
        .select("id, token_last4, patient_name, patient_email, amount_cents, status, payment_method_type, created_at, expires_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as EnrollmentStatus);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Enrollment[];
    },
  });

  const filteredEnrollments = (enrollments || []).filter((enrollment) => {
    const matchesSearch = 
      (enrollment.patient_name?.toLowerCase() || "").includes(searchQuery.toLowerCase()) ||
      (enrollment.patient_email?.toLowerCase() || "").includes(searchQuery.toLowerCase()) ||
      enrollment.token_last4.includes(searchQuery);
    
    return matchesSearch;
  });

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
    toast({
      title: "Refreshed",
      description: "Data has been refreshed",
    });
  };

  const handleCopyLink = (tokenLast4: string) => {
    // In a real implementation, you'd have the full token or a way to regenerate the link
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
    // TODO: Open detail modal or navigate to detail page
  };

  const handleResendLink = (enrollment: Enrollment) => {
    toast({
      title: "Resend Link",
      description: `Resend functionality for ${enrollment.patient_email || "Unknown"} - coming soon`,
    });
    // TODO: Implement resend via edge function
  };

  const handleRegenerateLink = (enrollment: Enrollment) => {
    toast({
      title: "Regenerate Link",
      description: `Regenerate functionality for ${enrollment.id} - coming soon`,
    });
    // TODO: Implement regenerate via edge function
  };

  const handleCancelEnrollment = async (enrollment: Enrollment) => {
    toast({
      title: "Cancel Enrollment",
      description: `Cancel functionality for ${enrollment.id} - coming soon`,
      variant: "destructive",
    });
    // TODO: Implement cancel via edge function
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((stat) => (
            <Card key={stat.title} className="card-premium">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">{stat.title}</p>
                    <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                    <p className="text-xs text-success mt-1">{stat.change}</p>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <stat.icon className="h-5 w-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
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
            {/* Filters and search */}
            <Card className="card-premium">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, email, or token..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-48">
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="created">Created</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="opened">Opened</SelectItem>
                      <SelectItem value="processing">Processing</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                      <SelectItem value="canceled">Canceled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" className="gap-2" onClick={handleRefresh}>
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Enrollments table */}
            <Card className="card-premium overflow-hidden">
              <CardHeader className="border-b border-border bg-muted/30">
                <CardTitle className="text-lg">Recent Enrollments</CardTitle>
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
                                <DropdownMenuItem onClick={() => handleRegenerateLink(enrollment)}>
                                  <RefreshCw className="h-4 w-4 mr-2" />
                                  Regenerate Link
                                </DropdownMenuItem>
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
      </main>
    </div>
  );
}
