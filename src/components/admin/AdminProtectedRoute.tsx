import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Loader2, Clock, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { MfaSetupChoice } from "./MfaSetupChoice";
import { MfaChallenge } from "./MfaChallenge";

function PendingAccess() {
  const { user, signOut, acceptInvite } = useAdminAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isAccepting, setIsAccepting] = useState(false);

  const handleAcceptInvite = async () => {
    setIsAccepting(true);
    try {
      const { error } = await acceptInvite();
      if (error) {
        toast({ title: "Could not accept invite", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Welcome!", description: "Your invite has been accepted." });
        navigate(0); // reload to re-evaluate auth state
      }
    } finally {
      setIsAccepting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/admin/login", { replace: true });
  };

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
          <Button variant="default" size="lg" className="w-full gap-2" onClick={handleAcceptInvite} disabled={isAccepting}>
            {isAccepting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Check for Invite
          </Button>
          <Button variant="outline" size="lg" className="w-full gap-2" onClick={handleSignOut}>
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

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

export function AdminProtectedRoute({ children }: AdminProtectedRouteProps) {
  const {
    isLoading,
    isAuthenticated,
    isAdmin,
    user,
    mfaVerified,
    mfaRequired,
    adminUser,
    signOut,
    setMfaVerified,
    setMfaMethod,
  } = useAdminAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  if (!isAdmin) {
    return <PendingAccess />;
  }

  // MFA not set up yet — force TOTP setup
  if (mfaRequired || (!adminUser?.mfa_method && !mfaVerified)) {
    return (
      <MfaSetupChoice
        userEmail={user?.email || ""}
        onComplete={async (method) => {
          await setMfaMethod(method);
        }}
        onSignOut={signOut}
      />
    );
  }

  // MFA set up but not verified this session (AAL1 instead of AAL2)
  if (!mfaVerified) {
    return (
      <MfaChallenge
        userEmail={user?.email || ""}
        onVerified={() => setMfaVerified()}
        onSignOut={signOut}
      />
    );
  }

  return <>{children}</>;
}
