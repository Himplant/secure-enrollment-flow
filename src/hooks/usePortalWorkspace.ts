import { useCallback, useEffect, useMemo } from "react";
import { usePortalAuth, type PortalMembership } from "./usePortalAuth";


const STORAGE_KEY = "portal.workspace";

export interface PortalWorkspace {
  key: string;
  orgType: "surgeon" | "distributor";
  orgId: string;
  role: PortalMembership["role"];
}

const toWorkspace = (m: PortalMembership): PortalWorkspace | null => {
  const orgId = m.org_type === "surgeon" ? m.surgeon_id : m.distributor_id;
  if (!orgId) return null;
  return { key: `${m.org_type}:${orgId}`, orgType: m.org_type, orgId, role: m.role };
};

/**
 * Resolves which organisation the portal user is currently acting as.
 * Purely a UI convenience — every edge function re-derives scope from the
 * caller's memberships, so switching workspaces can never widen access.
 */
export function usePortalWorkspace() {
  const { memberships, isLoading } = usePortalAuth();

  const workspaces = useMemo(
    () => memberships.map(toWorkspace).filter((w): w is PortalWorkspace => w !== null),
    [memberships],
  );

  const rawStored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;

  // A saved workspace that no longer maps to an active membership must never
  // linger — it would otherwise silently point at a revoked organisation.
  const stored = rawStored && workspaces.some((w) => w.key === rawStored) ? rawStored : null;
  if (typeof window !== "undefined" && rawStored && !stored && !isLoading && workspaces.length > 0) {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  const active = useMemo(
    () => workspaces.find((w) => w.key === stored) ?? workspaces[0] ?? null,
    [workspaces, stored],
  );

  // Persist the resolved workspace so every edge-function call carries it and
  // the server can narrow scope to this organisation alone.
  useEffect(() => {
    if (workspaces.length === 1 && active && stored !== active.key) {
      window.localStorage.setItem(STORAGE_KEY, active.key);
    }

  }, [active, stored]);


  const setActive = useCallback((key: string) => {
    window.localStorage.setItem(STORAGE_KEY, key);
    window.location.assign(key.startsWith("distributor:") ? "/portal/distributor" : "/portal");
  }, []);


  return {
    isLoading,
    workspaces,
    active,
    setActive,
    needsChoice: workspaces.length > 1 && !stored,
    isDistributor: active?.orgType === "distributor",
    // Permission checks read the ACTIVE membership only: being an admin of one
    // organisation must never grant admin rights inside another.
    isSurgeonAdmin: active?.role === "surgeon_admin",
    isDistributorAdmin: active?.role === "distributor_admin",
    isReadOnly: active?.role === "surgeon_analyst" || active?.role === "distributor_analyst" ||
      active?.orgType === "distributor",
  };
}

