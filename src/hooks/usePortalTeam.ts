import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokePortal } from "./usePortalConsultations";

export interface PortalTeamMember {
  membership_id: string;
  surgeon_id: string;
  role: "surgeon_admin" | "surgeon_staff" | "surgeon_analyst";
  is_active: boolean;
  granted_at: string;
  user: {
    email: string;
    full_name: string | null;
    accepted_at: string | null;
    last_login_at: string | null;
  } | null;
}

export interface PortalTeamPayload {
  surgeons: { id: string; name: string }[];
  members: PortalTeamMember[];
}

export function usePortalTeam(enabled: boolean) {
  return useQuery({
    queryKey: ["portal-team"],
    enabled,
    queryFn: () => invokePortal<PortalTeamPayload>("intl-portal-team", { action: "list" }),
  });
}

export function usePortalTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      invokePortal<PortalTeamPayload>("intl-portal-team", payload),
    onSuccess: (data) => qc.setQueryData(["portal-team"], data),
  });
}
