import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Search, 
  Filter, 
  RefreshCw, 
  Plus,
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
  Settings
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

// Mock data
const mockEnrollments = [
  {
    id: "1",
    tokenLast4: "a1b2",
    patientName: "John Smith",
    patientEmail: "john@example.com",
    amount: 125000,
    status: "paid" as const,
    paymentMethod: "card" as const,
    createdAt: new Date("2024-01-15"),
    expiresAt: new Date("2024-01-17"),
    paidAt: new Date("2024-01-16"),
  },
  {
    id: "2",
    tokenLast4: "c3d4",
    patientName: "Sarah Johnson",
    patientEmail: "sarah@example.com",
    amount: 85000,
    status: "processing" as const,
    paymentMethod: "ach" as const,
    createdAt: new Date("2024-01-16"),
    expiresAt: new Date("2024-01-18"),
    processingAt: new Date("2024-01-16"),
  },
  {
    id: "3",
    tokenLast4: "e5f6",
    patientName: "Michael Brown",
    patientEmail: "michael@example.com",
    amount: 200000,
    status: "opened" as const,
    createdAt: new Date("2024-01-17"),
    expiresAt: new Date("2024-01-19"),
  },
  {
    id: "4",
    tokenLast4: "g7h8",
    patientName: "Emily Davis",
    patientEmail: "emily@example.com",
    amount: 150000,
    status: "sent" as const,
    createdAt: new Date("2024-01-17"),
    expiresAt: new Date("2024-01-19"),
  },
  {
    id: "5",
    tokenLast4: "i9j0",
    patientName: "Robert Wilson",
    patientEmail: "robert@example.com",
    amount: 95000,
    status: "expired" as const,
    createdAt: new Date("2024-01-10"),
    expiresAt: new Date("2024-01-12"),
  },
];

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

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, adminUser, signOut } = useAdminAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("enrollments");

  const filteredEnrollments = mockEnrollments.filter((enrollment) => {
    const matchesSearch = 
      enrollment.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      enrollment.patientEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      enrollment.tokenLast4.includes(searchQuery);
    
    const matchesStatus = statusFilter === "all" || enrollment.status === statusFilter;
    
    return matchesSearch && matchesStatus;
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
                    Role: {adminUser?.role}
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
                  <Button variant="outline" className="gap-2">
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
                              {enrollment.patientName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {enrollment.patientEmail}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatAmount(enrollment.amount)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={enrollment.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {enrollment.paymentMethod === 'card' ? 'Card' : 
                           enrollment.paymentMethod === 'ach' ? 'ACH' : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(enrollment.createdAt, 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(enrollment.expiresAt, 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>
                                <Eye className="h-4 w-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <Copy className="h-4 w-4 mr-2" />
                                Copy Link
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <Send className="h-4 w-4 mr-2" />
                                Resend Link
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Regenerate Link
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive">
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
