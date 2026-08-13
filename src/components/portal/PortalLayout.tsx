import { ReactNode } from "react";
import { BarChart3, Building2, CreditCard, LayoutList, LogOut, Users } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePortalAuth } from "@/hooks/usePortalAuth";
import { usePortalWorkspace } from "@/hooks/usePortalWorkspace";
import { cn } from "@/lib/utils";
import { friendlyRoleLabel } from "@/lib/portalAccessLevels";


export function PortalLayout({ children }: { children: ReactNode }) {
  const { portalUser, signOut } = usePortalAuth();
  const { workspaces, active, setActive, isDistributor, isSurgeonAdmin, isDistributorAdmin } =
    usePortalWorkspace();
  const { pathname } = useLocation();

  const orgLabel = active?.name ?? (isDistributor ? "Distributor portal" : "Surgeon portal");
  const roleLabel = active ? friendlyRoleLabel(active.role) : isDistributor ? "Distributor" : "Surgeon";


  const nav = [
    ...(isDistributor ? [{ to: "/portal/distributor", label: "Overview", icon: BarChart3 }] : []),
    { to: "/portal", label: "Consultations", icon: LayoutList },
    ...(isDistributor ? [] : [{ to: "/portal/reports", label: "Reports", icon: BarChart3 }]),
    ...(isSurgeonAdmin && !isDistributor
      ? [
          { to: "/portal/team", label: "Team", icon: Users },
          { to: "/portal/payment-account", label: "Payment account", icon: CreditCard },
        ]
      : []),
    ...(isDistributorAdmin && isDistributor
      ? [{ to: "/portal/team", label: "Team", icon: Users }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">
                {orgLabel} — {roleLabel}
              </p>
              <p className="text-xs text-muted-foreground">
                {portalUser?.full_name || portalUser?.email}
              </p>

            </div>
          </div>

          <div className="flex items-center gap-2">
            {workspaces.length > 1 && active && (
              <Select value={active.key} onValueChange={setActive}>
                <SelectTrigger className="h-9 w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.key} value={w.key}>
                      {w.name} · {w.role.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 pb-1">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
                pathname === item.to && "bg-muted font-medium text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
