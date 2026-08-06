import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { usePortalAuth } from "@/hooks/usePortalAuth";
import { usePortalWorkspace } from "@/hooks/usePortalWorkspace";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { isSurgeonPortalEnabled, isDistributorPortalEnabled } from "@/lib/featureFlags";
import { Card, CardContent } from "@/components/ui/card";

/** Guards every /portal route: portal identity + the relevant portal flag. */
export function PortalProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, isPortalUser, memberships, portalUser, mfaVerified, signOut } =
    usePortalAuth();
  const { needsChoice, active } = usePortalWorkspace();
  const { pathname } = useLocation();
  const { flags, isLoading: flagsLoading } = useFeatureFlags();

  if (isLoading || flagsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/portal/login" replace />;

  if (needsChoice && pathname !== "/portal/select-workspace") {
    return <Navigate to="/portal/select-workspace" replace />;
  }

  // AAL2 is mandatory for administrator roles in the ACTIVE workspace, and for
  // any account explicitly flagged as mfa_required.
  const activeRoleNeedsMfa = active?.role === "surgeon_admin" || active?.role === "distributor_admin";
  if (
    isPortalUser &&
    (activeRoleNeedsMfa || portalUser?.mfa_required) &&
    !mfaVerified &&
    pathname !== "/portal/mfa"
  ) {
    return <Navigate to="/portal/mfa" replace />;
  }


  const hasSurgeon = memberships.some((m) => m.org_type === "surgeon");
  const hasDistributor = memberships.some((m) => m.org_type === "distributor");
  const allowed =
    (hasSurgeon && isSurgeonPortalEnabled(flags)) ||
    (hasDistributor && isDistributorPortalEnabled(flags));

  if (!isPortalUser || !allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 space-y-3 text-center">
            <h1 className="text-lg font-semibold">Portal access unavailable</h1>
            <p className="text-sm text-muted-foreground">
              This account does not have an active portal membership, or the portal is not yet
              enabled for your organization.
            </p>
            <button className="text-sm text-primary underline" onClick={() => signOut()}>
              Sign out
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
