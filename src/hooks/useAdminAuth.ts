import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";

interface AdminUser {
  id: string;
  user_id: string | null;
  email: string;
  role: "admin" | "viewer";
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

  useEffect(() => {
    // Set up auth state listener BEFORE getting session
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          // Fetch admin user data
          const { data: adminUser } = await supabase
            .from("admin_users")
            .select("*")
            .eq("user_id", session.user.id)
            .single();

          setState({
            user: session.user,
            session,
            adminUser: adminUser as AdminUser | null,
            isLoading: false,
            isAdmin: !!adminUser?.accepted_at,
            isAuthenticated: true,
          });
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
      if (session?.user) {
        const { data: adminUser } = await supabase
          .from("admin_users")
          .select("*")
          .eq("user_id", session.user.id)
          .single();

        setState({
          user: session.user,
          session,
          adminUser: adminUser as AdminUser | null,
          isLoading: false,
          isAdmin: !!adminUser?.accepted_at,
          isAuthenticated: true,
        });
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const acceptInvite = async () => {
    if (!state.user) return { error: new Error("Not authenticated") };

    // Check if user has a pending invite by email
    const { data: invite, error: fetchError } = await supabase
      .from("admin_users")
      .select("*")
      .eq("email", state.user.email)
      .is("accepted_at", null)
      .single();

    if (fetchError || !invite) {
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
      return { error };
    }

    // Refresh state
    const { data: adminUser } = await supabase
      .from("admin_users")
      .select("*")
      .eq("user_id", state.user.id)
      .single();

    setState(prev => ({
      ...prev,
      adminUser: adminUser as AdminUser | null,
      isAdmin: !!adminUser?.accepted_at,
    }));

    return { error: null };
  };

  return {
    ...state,
    signOut,
    acceptInvite,
  };
}
