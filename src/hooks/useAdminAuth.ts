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
}

interface AdminAuthState {
  user: User | null;
  session: Session | null;
  adminUser: AdminUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  isAuthenticated: boolean;
}

export function useAdminAuth() {
  const [state, setState] = useState<AdminAuthState>({
    user: null,
    session: null,
    adminUser: null,
    isLoading: true,
    isAdmin: false,
    isAuthenticated: false,
  });

  const fetchAdminUser = useCallback(async (userId: string, userEmail: string | undefined) => {
    // First try to find by user_id (already accepted)
    let { data: adminUser, error } = await supabase
      .from("admin_users")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    // If not found by user_id, try to find by email (pending invite)
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

  useEffect(() => {
    let mounted = true;

    // Set up auth state listener BEFORE getting session
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        if (session?.user) {
          // Use setTimeout to avoid potential deadlock with Supabase client
          setTimeout(async () => {
            if (!mounted) return;
            const adminUser = await fetchAdminUser(session.user.id, session.user.email);
            
            if (mounted) {
              setState({
                user: session.user,
                session,
                adminUser,
                isLoading: false,
                isAdmin: !!adminUser?.accepted_at,
                isAuthenticated: true,
              });
            }
          }, 0);
        } else {
          setState({
            user: null,
            session: null,
            adminUser: null,
            isLoading: false,
            isAdmin: false,
            isAuthenticated: false,
          });
        }
      }
    );

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;

      if (session?.user) {
        const adminUser = await fetchAdminUser(session.user.id, session.user.email);
        
        if (mounted) {
          setState({
            user: session.user,
            session,
            adminUser,
            isLoading: false,
            isAdmin: !!adminUser?.accepted_at,
            isAuthenticated: true,
          });
        }
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchAdminUser]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const acceptInvite = async () => {
    if (!state.user?.email) return { error: new Error("Not authenticated") };

    // Check if user has a pending invite by email
    const { data: invite, error: fetchError } = await supabase
      .from("admin_users")
      .select("*")
      .eq("email", state.user.email.toLowerCase())
      .is("accepted_at", null)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching invite:", fetchError);
      return { error: new Error("Failed to check for invite") };
    }

    if (!invite) {
      return { error: new Error("No pending invite found for this email") };
    }

    // Accept the invite
    const { error } = await supabase
      .from("admin_users")
      .update({
        user_id: state.user.id,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invite.id);

    if (error) {
      console.error("Error accepting invite:", error);
      return { error };
    }

    // Refresh state
    const adminUser = await fetchAdminUser(state.user.id, state.user.email);

    setState(prev => ({
      ...prev,
      adminUser,
      isAdmin: !!adminUser?.accepted_at,
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
  };
}
