/**
 * Friendly access levels for the portal.
 *
 * Operators pick "Admin / Staff / View only"; the raw role codes stay an
 * internal implementation detail. Kept pure so the mapping can be tested.
 */
import type { PortalRoleName } from "./portalAccess";

export type PortalOrgKind = "surgeon" | "distributor";
export type AccessLevel = "admin" | "staff" | "view_only";

export interface AccessLevelOption {
  value: AccessLevel;
  label: string;
  description: (org: PortalOrgKind) => string;
}

export const ACCESS_LEVELS: AccessLevelOption[] = [
  {
    value: "admin",
    label: "Admin",
    description: (org) =>
      org === "surgeon"
        ? "Manages the team and connects the practice payment account."
        : "Manages the distributor team and oversees assigned surgeons.",
  },
  {
    value: "staff",
    label: "Staff",
    description: (org) =>
      org === "surgeon"
        ? "Works consultations day to day. No team or payment settings."
        : "Read-only oversight of assigned surgeons.",
  },
  {
    value: "view_only",
    label: "View only",
    description: () => "Reports and consultations, read-only. No changes.",
  },
];

const ROLE_BY_LEVEL: Record<PortalOrgKind, Record<AccessLevel, PortalRoleName>> = {
  surgeon: {
    admin: "surgeon_admin",
    staff: "surgeon_staff",
    view_only: "surgeon_analyst",
  },
  distributor: {
    admin: "distributor_admin",
    staff: "distributor_staff",
    view_only: "distributor_analyst",
  },
};

/** Friendly level → the existing role code stored in portal_memberships. */
export function toRoleCode(org: PortalOrgKind, level: AccessLevel): PortalRoleName {
  return ROLE_BY_LEVEL[org][level];
}

/** Role code → friendly level. */
export function toAccessLevel(role: PortalRoleName): AccessLevel {
  if (role.endsWith("_admin")) return "admin";
  if (role.endsWith("_analyst")) return "view_only";
  return "staff";
}

export function orgKindOfRole(role: PortalRoleName): PortalOrgKind {
  return role.startsWith("distributor") ? "distributor" : "surgeon";
}

export function accessLevelLabel(level: AccessLevel): string {
  return ACCESS_LEVELS.find((l) => l.value === level)?.label ?? "Staff";
}

/** Header label such as "Surgeon Admin" or "Distributor View only". */
export function friendlyRoleLabel(role: PortalRoleName): string {
  const org = orgKindOfRole(role) === "distributor" ? "Distributor" : "Surgeon";
  return `${org} ${accessLevelLabel(toAccessLevel(role))}`;
}
