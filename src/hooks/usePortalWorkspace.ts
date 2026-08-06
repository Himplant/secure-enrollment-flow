import { useCallback, useMemo } from "react";
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

  const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;

  const active = useMemo(
    () => workspaces.find((w) => w.key === stored) ?? workspaces[0] ?? null,
    [workspaces, stored],
  );

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
    isSurgeonAdmin: workspaces.some((w) => w.role === "surgeon_admin"),
  };
}
