import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Loader2, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useToast } from "@/hooks/use-toast";

export default function AdminPending() {
  const navigate = useNavigate();
  const { user, isAdmin, isAuthenticated, isLoading, signOut, acceptInvite } = useAdminAuth();
  const { toast } = useToast();
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/admin/login", { replace: true });
    } else if (!isLoading && isAdmin) {
      navigate("/admin", { replace: true });
    }
  }, [isAuthenticated, isAdmin, isLoading, navigate]);

  const handleAcceptInvite = async () => {
    setIsAccepting(true);
    try {
      const { error } = await acceptInvite();
      if (error) {
        toast({
          title: "Could not accept invite",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Welcome!",
          description: "Your invite has been accepted. Redirecting...",
        });
        navigate("/admin", { replace: true });
      }
    } finally {
      setIsAccepting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/admin/login", { replace: true });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md card-premium">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center mb-4">
            <Clock className="h-6 w-6 text-warning" />
          </div>
          <CardTitle className="text-2xl">Access Pending</CardTitle>
          <CardDescription>
            Signed in as <span className="font-medium text-foreground">{user?.email}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Your account hasn't been granted admin access yet. If you've received an invite, click below to accept it.
          </p>

          <Button
            variant="default"
            size="lg"
            className="w-full gap-2"
            onClick={handleAcceptInvite}
            disabled={isAccepting}
          >
            {isAccepting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Check for Invite
          </Button>

          <Button
            variant="outline"
            size="lg"
            className="w-full gap-2"
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Contact your administrator if you need access to the dashboard.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
