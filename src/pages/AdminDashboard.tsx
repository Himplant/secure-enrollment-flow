import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { 
  LogOut,
  Settings,
  RefreshCw,
  Users,
  Receipt,
  FileText,
  UserCog
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { UserManagement } from "@/components/admin/UserManagement";
import { DashboardStats } from "@/components/admin/DashboardStats";
import { SurgeonDistributionCard } from "@/components/admin/SurgeonDistributionCard";
import { PatientsTab } from "@/components/admin/PatientsTab";
import { TransactionsTab } from "@/components/admin/TransactionsTab";
import { PoliciesTab } from "@/components/admin/PoliciesTab";
import { SurgeonManagement } from "@/components/admin/SurgeonManagement";
import { useToast } from "@/hooks/use-toast";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, adminUser, signOut } = useAdminAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("patients");

  const handleSignOut = async () => {
    await signOut();
    navigate("/admin/login", { replace: true });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["patients"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    queryClient.invalidateQueries({ queryKey: ["enrollment-stats"] });
    queryClient.invalidateQueries({ queryKey: ["policies"] });
    queryClient.invalidateQueries({ queryKey: ["surgeons"] });
    queryClient.invalidateQueries({ queryKey: ["surgeons-management"] });
    toast({
      title: "Refreshed",
      description: "Data has been refreshed",
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
                Manage patients, enrollments and payments
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4" />
              </Button>
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
        <div className="mb-8 space-y-6">
          <DashboardStats />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SurgeonDistributionCard />
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="patients" className="gap-2">
              <Users className="h-4 w-4" />
              Patients
            </TabsTrigger>
            <TabsTrigger value="transactions" className="gap-2">
              <Receipt className="h-4 w-4" />
              Transactions
            </TabsTrigger>
            <TabsTrigger value="policies" className="gap-2">
              <FileText className="h-4 w-4" />
              Policies
            </TabsTrigger>
            <TabsTrigger value="surgeons" className="gap-2">
              <UserCog className="h-4 w-4" />
              Surgeons
            </TabsTrigger>
            {(adminUser?.role === "admin" || adminUser?.role === "super_admin") && (
              <TabsTrigger value="users" className="gap-2">
                <Settings className="h-4 w-4" />
                User Management
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="patients">
            <PatientsTab />
          </TabsContent>

          <TabsContent value="transactions">
            <TransactionsTab />
          </TabsContent>

          <TabsContent value="policies">
            <PoliciesTab />
          </TabsContent>

          <TabsContent value="surgeons">
            <SurgeonManagement />
          </TabsContent>

          {(adminUser?.role === "admin" || adminUser?.role === "super_admin") && (
            <TabsContent value="users">
              <UserManagement />
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}
