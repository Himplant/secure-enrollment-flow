import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

/**
 * Authentication state for EXTERNAL portal users (distributors, surgeons,
 * surgeon office staff).
 *
 * Deliberately separate from `useAdminAuth`. The two models never share code:
 * an international bug must not be able to weaken Himplant admin auth or its
 * mandatory TOTP requirement.
 */

export type PortalRole =
  | "distributor_admin"
  | "distributor_staff"
  | "distributor_analyst"
  | "surgeon_admin"
  | "surgeon_staff"
  | "surgeon_analyst";

export type PortalOrgType = "distributor" | "surgeon";

export interface PortalMembership {
  id: string;
  org_type: PortalOrgType;
  distributor_id: string | null;
  surgeon_id: string | null;
  role: PortalRole;
  is_active: boolean;
}

export interface PortalUser {
  id: string;
  user_id: string | null;
  email: string;
  full_name: string | null;
  is_active: boolean;
  mfa_required: boolean;
  accepted_at: string | null;
}

interface PortalAuthState {
  user: User | null;
  session: Session | null;
  portalUser: PortalUser | null;
  memberships: PortalMembership[];
  isLoading: boolean;
  isAuthenticated: boolean;
  isPortalUser: boolean;
  mfaVerified: boolean;
}

const EMPTY_STATE: PortalAuthState = {
  user: null,
  session: null,
  portalUser: null,
  memberships: [],
  isLoading: false,
  isAuthenticated: false,
  isPortalUser: false,
  mfaVerified: false,
};

export function usePortalAuth() {
  const [state, setState] = useState<PortalAuthState>({ ...EMPTY_STATE, isLoading: true });

  const fetchPortalUser = useCallback(
    async (userId: string, email: string | undefined) => {
      let { data: portalUser } = await supabase
        .from("portal_users")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      // Pending invite: matched by email until the user accepts it.
      if (!portalUser && email) {
        const { data: invite } = await supabase
          .from("portal_users")
          .select("*")
          .ilike("email", email)
          .is("accepted_at", null)
          .maybeSingle();
        portalUser = invite;
      }

      if (!portalUser) return { portalUser: null, memberships: [] as PortalMembership[] };

      const { data: memberships } = await supabase
        .from("portal_memberships")
        .select("id, org_type, distributor_id, surgeon_id, role, is_active")
        .eq("portal_user_id", portalUser.id)
        .eq("is_active", true)
        .is("revoked_at", null);

      return {
        portalUser: portalUser as PortalUser,
        memberships: (memberships ?? []) as PortalMembership[],
      };
    },
    [],
  );

  const checkAal = useCallback(async (): Promise<boolean> => {
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      return data?.currentLevel === "aal2";
    } catch {
      return false;
    }
  }, []);

  const resolveState = useCallback(
    async (session: Session): Promise<PortalAuthState> => {
      const { portalUser, memberships } = await fetchPortalUser(
        session.user.id,
        session.user.email,
      );
      const mfaVerified = await checkAal();

      return {
        user: session.user,
        session,
        portalUser,
        memberships,
        isLoading: false,
        isAuthenticated: true,
        isPortalUser: !!portalUser?.accepted_at && !!portalUser?.is_active,
        mfaVerified,
      };
    },
    [fetchPortalUser, checkAal],
  );

  useEffect(() => {
    let mounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      if (session?.user) {
        // Defer Supabase calls out of the auth callback.
        setTimeout(async () => {
          if (!mounted) return;
          const next = await resolveState(session);
          if (mounted) setState(next);
        }, 0);
      } else {
        setState({ ...EMPTY_STATE });
      }
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        const next = await resolveState(session);
        if (mounted) setState(next);
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [resolveState]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const surgeonMemberships = state.memberships.filter((m) => m.org_type === "surgeon");
  const distributorMemberships = state.memberships.filter((m) => m.org_type === "distributor");

  const hasRole = (role: PortalRole) => state.memberships.some((m) => m.role === role);

  return {
    ...state,
    surgeonMemberships,
    distributorMemberships,
    hasRole,
    signOut,
  };
}
