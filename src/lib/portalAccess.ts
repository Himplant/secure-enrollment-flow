/**
 * Pure routing policy for the international portal guard.
 *
 * Kept free of React so the ordering rules (workspace choice before MFA) can be
 * unit tested exactly as the guard evaluates them.
 */

export type PortalRoleName =
  | "surgeon_admin"
  | "surgeon_staff"
  | "surgeon_analyst"
  | "distributor_admin"
  | "distributor_staff"
  | "distributor_analyst";

export interface PortalRouteInput {
  isAuthenticated: boolean;
  isPortalUser: boolean;
  /** True when several memberships exist and none has been selected yet. */
  needsChoice: boolean;
  activeRole: PortalRoleName | null;
  /** Account-level forced MFA — only honoured after a workspace is resolved. */
  mfaRequired: boolean;
  mfaVerified: boolean;
  pathname: string;
}

export type PortalRouteDecision =
  | { type: "login" }
  | { type: "choose-workspace" }
  | { type: "mfa" }
  | { type: "allow" };

/** Administrator roles must always complete AAL2 in their active workspace. */
export function roleRequiresMfa(role: PortalRoleName | null): boolean {
  return role === "surgeon_admin" || role === "distributor_admin";
}

export function resolvePortalRoute(i: PortalRouteInput): PortalRouteDecision {
  if (!i.isAuthenticated) return { type: "login" };

  // Workspace choice strictly precedes MFA: with no active workspace there is
  // no role to base the MFA policy on.
  if (i.needsChoice) {
    return i.pathname === "/portal/select-workspace" ? { type: "allow" } : { type: "choose-workspace" };
  }

  if (
    i.isPortalUser &&
    i.activeRole !== null &&
    (roleRequiresMfa(i.activeRole) || i.mfaRequired) &&
    !i.mfaVerified &&
    i.pathname !== "/portal/mfa"
  ) {
    return { type: "mfa" };
  }

  return { type: "allow" };
}
