import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { usePortalAuth } from "@/hooks/usePortalAuth";
import { usePortalWorkspace } from "@/hooks/usePortalWorkspace";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { isSurgeonPortalEnabled, isDistributorPortalEnabled } from "@/lib/featureFlags";
import { resolvePortalRoute } from "@/lib/portalAccess";
import { Card, CardContent } from "@/components/ui/card";

/** Guards every /portal route: portal identity + the relevant portal flag. */
export function PortalProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, isPortalUser, portalUser, mfaVerified, signOut } =
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

  const decision = resolvePortalRoute({
    isAuthenticated,
    isPortalUser,
    needsChoice,
    activeRole: active?.role ?? null,
    mfaRequired: !!portalUser?.mfa_required,
    mfaVerified,
    pathname,
  });

  if (decision.type === "login") return <Navigate to="/portal/login" replace />;
  // Workspace choice ALWAYS precedes MFA: without an active workspace there is
  // no role to base the MFA policy on.
  if (decision.type === "choose-workspace") return <Navigate to="/portal/select-workspace" replace />;
  if (decision.type === "mfa") return <Navigate to="/portal/mfa" replace />;
  if (needsChoice) return <>{children}</>;





  // Feature enablement is evaluated for the ACTIVE workspace only: a surgeon
  // membership must not keep the distributor portal open, or vice versa.
  const allowed = active
    ? active.orgType === "surgeon"
      ? isSurgeonPortalEnabled(flags)
      : isDistributorPortalEnabled(flags)
    : false;


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
