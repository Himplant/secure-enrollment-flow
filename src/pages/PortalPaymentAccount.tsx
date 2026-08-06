import { Navigate } from "react-router-dom";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { ProviderSetupPanel } from "@/components/providers/ProviderSetupPanel";
import { usePortalAuth } from "@/hooks/usePortalAuth";

/**
 * Surgeon-admin only: connect and manage this practice's own payment account.
 * Staff, analysts and distributor roles never see credential controls.
 */
export default function PortalPaymentAccount() {
  const { memberships, loading } = usePortalAuth();

  if (loading) return null;

  const isSurgeonAdmin = memberships.some(
    (m) => m.org_type === "surgeon" && m.role === "surgeon_admin" && m.is_active,
  );

  if (!isSurgeonAdmin) return <Navigate to="/portal" replace />;

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Payment account</h1>
          <p className="text-sm text-muted-foreground">
            Consultation fees settle directly into your own merchant account.
          </p>
        </div>
        <ProviderSetupPanel scope="portal" />
      </div>
    </PortalLayout>
  );
}
