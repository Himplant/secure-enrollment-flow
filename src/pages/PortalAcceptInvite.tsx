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
 * Accept a portal invitation.
 *
 * Supabase delivers the invite link with a session in the URL hash, so the
 * user is already authenticated by the time this page renders. They set a
 * password, then the server binds their auth id to the pending portal_users
 * row — strictly matching on the authenticated email.
 */
export default function PortalAcceptInvite() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setEmail(session?.user?.email ?? null);
      setChecking(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 12) {
      toast.error("Use at least 12 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSaving(false);
      toast.error(error.message);
      return;
    }
    const { data, error: fnError } = await supabase.functions.invoke("intl-portal-identity", {
      body: { action: "accept_invite" },
    });
    setSaving(false);
    if (fnError || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? fnError?.message ?? "Could not finish setup");
      return;
    }
    toast.success("Your portal account is ready");
    navigate("/portal", { replace: true });
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Set up your portal account</CardTitle>
          <CardDescription>
            {email ? `Creating a password for ${email}` : "Open the invitation link from your email to continue."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {email ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Activate account
              </Button>
            </form>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => navigate("/portal/login")}>
              Go to portal sign in
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
