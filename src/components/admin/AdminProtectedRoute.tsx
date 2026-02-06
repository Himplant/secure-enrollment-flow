import { Navigate, useLocation } from "react-router-dom";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Loader2 } from "lucide-react";
import { MfaSetupChoice } from "./MfaSetupChoice";
import { MfaChallenge } from "./MfaChallenge";

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
    return <Navigate to="/admin/pending" state={{ from: location }} replace />;
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
