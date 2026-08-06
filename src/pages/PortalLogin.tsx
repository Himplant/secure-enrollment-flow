import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Building2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Login for EXTERNAL portal users (surgeons, surgeon staff, distributors).
 * Completely separate from the Himplant admin login and its TOTP flow.
 */
export default function PortalLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot">("signin");

  // A Himplant admin who lands here belongs in the admin console.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted || !session?.user) return;
      const { data: adminRow } = await supabase
        .from("admin_users")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (mounted && adminRow) navigate("/admin", { replace: true });
    })();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }

    // Admins never continue into the portal.
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("id")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (adminRow) {
      setLoading(false);
      navigate("/admin", { replace: true });
      return;
    }

    // Binds the auth identity to the portal record and records the login.
    await supabase.functions.invoke("intl-portal-identity", { body: { action: "touch_login" } });
    setLoading(false);
    navigate("/portal", { replace: true });
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/portal/reset-password`,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("If that email has portal access, a reset link is on its way.");
    setMode("signin");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Partner Portal</CardTitle>
          <CardDescription>
            {mode === "signin"
              ? "Sign in to manage your consultations."
              : "We'll email you a link to reset your password."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={mode === "signin" ? handleSignIn : handleForgot} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {mode === "signin" && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {mode === "signin" ? "Sign in" : "Send reset link"}
            </Button>
          </form>
          <Button
            variant="link"
            className="w-full mt-2 text-muted-foreground"
            onClick={() => setMode(mode === "signin" ? "forgot" : "signin")}
          >
            {mode === "signin" ? "Forgot your password?" : "Back to sign in"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
