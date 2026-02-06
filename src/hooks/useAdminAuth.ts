import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";

interface AdminUser {
  id: string;
  user_id: string | null;
  email: string;
  role: "admin" | "viewer" | "super_admin";
  invited_at: string;
  accepted_at: string | null;
  mfa_method: string | null;
}

interface AdminAuthState {
  user: User | null;
  session: Session | null;
  adminUser: AdminUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  isAuthenticated: boolean;
  mfaVerified: boolean;
  mfaRequired: boolean;
}

export function useAdminAuth() {
  const [state, setState] = useState<AdminAuthState>({
    user: null,
    session: null,
    adminUser: null,
    isLoading: true,
    isAdmin: false,
    isAuthenticated: false,
    mfaVerified: false,
    mfaRequired: false,
  });

  const fetchAdminUser = useCallback(async (userId: string, userEmail: string | undefined) => {
    let { data: adminUser } = await supabase
      .from("admin_users")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!adminUser && userEmail) {
      const { data: pendingInvite } = await supabase
        .from("admin_users")
        .select("*")
        .eq("email", userEmail.toLowerCase())
        .is("accepted_at", null)
        .maybeSingle();
      adminUser = pendingInvite;
    }

    return adminUser as AdminUser | null;
  }, []);

  const checkMfaStatus = useCallback(async (): Promise<{ hasTotpFactor: boolean; aal: string }> => {
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const hasTotpFactor = (factors?.totp?.length ?? 0) > 0 && factors?.totp?.some(f => f.status === "verified");
      
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      return {
        hasTotpFactor: !!hasTotpFactor,
        aal: aal?.currentLevel || "aal1",
      };
    } catch {
      return { hasTotpFactor: false, aal: "aal1" };
    }
  }, []);

  const resolveState = useCallback(async (session: Session) => {
    const adminUser = await fetchAdminUser(session.user.id, session.user.email);
    const { hasTotpFactor, aal } = await checkMfaStatus();

    const isAccepted = !!adminUser?.accepted_at;
    // SECURITY: MFA is TOTP-only, verified server-side via Supabase AAL2
    const mfaVerified = isAccepted && hasTotpFactor && aal === "aal2";
    const mfaRequired = isAccepted && !hasTotpFactor; // needs to set up TOTP

    return {
      user: session.user,
      session,
      adminUser,
      isLoading: false,
      isAdmin: isAccepted,
      isAuthenticated: true,
      mfaVerified,
      mfaRequired,
    };
  }, [fetchAdminUser, checkMfaStatus]);

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;

        if (session?.user) {
          setTimeout(async () => {
            if (!mounted) return;
            const newState = await resolveState(session);
            if (mounted) setState(newState);
          }, 0);
        } else {
          setState({
            user: null,
            session: null,
            adminUser: null,
            isLoading: false,
            isAdmin: false,
            isAuthenticated: false,
            mfaVerified: false,
            mfaRequired: false,
          });
        }
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;

      if (session?.user) {
        const newState = await resolveState(session);
        if (mounted) setState(newState);
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
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

  const setMfaVerified = () => {
    setState(prev => ({ ...prev, mfaVerified: true }));
  };

  const setMfaMethod = async (method: "totp") => {
    if (!state.user) return;
    
    await supabase
      .from("admin_users")
      .update({ mfa_method: method })
      .eq("user_id", state.user.id);

    setState(prev => ({
      ...prev,
      mfaRequired: false,
      mfaVerified: true,
      adminUser: prev.adminUser ? { ...prev.adminUser, mfa_method: method } : null,
    }));
  };

  const acceptInvite = async () => {
    if (!state.user?.email) return { error: new Error("Not authenticated") };

    const { data: invite, error: fetchError } = await supabase
      .from("admin_users")
      .select("*")
      .eq("email", state.user.email.toLowerCase())
      .is("accepted_at", null)
      .maybeSingle();

    if (fetchError) return { error: new Error("Failed to check for invite") };
    if (!invite) return { error: new Error("No pending invite found for this email") };

    const { error } = await supabase
      .from("admin_users")
      .update({
        user_id: state.user.id,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invite.id);

    if (error) return { error };

    const adminUser = await fetchAdminUser(state.user.id, state.user.email);
    setState(prev => ({
      ...prev,
      adminUser,
      isAdmin: !!adminUser?.accepted_at,
      mfaRequired: !!adminUser?.accepted_at && !adminUser?.mfa_method,
    }));

    return { error: null };
  };

  const refreshAdminUser = async () => {
    if (!state.user) return;
    const adminUser = await fetchAdminUser(state.user.id, state.user.email);
    setState(prev => ({
      ...prev,
      adminUser,
      isAdmin: !!adminUser?.accepted_at,
    }));
  };

  return {
    ...state,
    signOut,
    acceptInvite,
    refreshAdminUser,
    setMfaVerified,
    setMfaMethod,
  };
}
