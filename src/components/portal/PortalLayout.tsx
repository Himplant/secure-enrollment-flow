import { ReactNode } from "react";
import { Building2, CreditCard, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePortalAuth } from "@/hooks/usePortalAuth";

export function PortalLayout({ children }: { children: ReactNode }) {
  const { portalUser, memberships, signOut } = usePortalAuth();

  const orgLabel = memberships.some((m) => m.org_type === "distributor")
    ? "Distributor portal"
    : "Surgeon portal";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">{orgLabel}</p>
              <p className="text-xs text-muted-foreground">
                {portalUser?.full_name || portalUser?.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {memberships.some((m) => m.org_type === "surgeon" && m.role === "surgeon_admin" && m.is_active) && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/portal/payment-account">
                  <CreditCard className="mr-2 h-4 w-4" />
                  Payment account
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
            <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
