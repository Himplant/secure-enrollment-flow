import { Navigate } from "react-router-dom";
import { Building2, Loader2, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePortalWorkspace } from "@/hooks/usePortalWorkspace";
import { usePortalAuth } from "@/hooks/usePortalAuth";

const ROLE_LABEL = (role: string) => role.replace(/_/g, " ");

/** Shown when a portal user belongs to more than one organisation. */
export default function PortalSelectWorkspace() {
  const { portalUser } = usePortalAuth();
  const { workspaces, setActive, isLoading } = usePortalWorkspace();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (workspaces.length <= 1) return <Navigate to="/portal" replace />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Choose a workspace</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {portalUser?.full_name || portalUser?.email}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((w) => (
            <Card key={w.key} className="transition-colors hover:border-primary/50">
              <CardHeader className="pb-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                  {w.orgType === "distributor" ? (
                    <Building2 className="h-5 w-5 text-primary" />
                  ) : (
                    <Stethoscope className="h-5 w-5 text-primary" />
                  )}
                </div>
                <CardTitle className="text-base capitalize">
                  {w.orgType === "distributor" ? "Distributor portal" : "Surgeon portal"}
                </CardTitle>
                <CardDescription className="capitalize">{ROLE_LABEL(w.role)}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" onClick={() => setActive(w.key)}>
                  Continue
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
