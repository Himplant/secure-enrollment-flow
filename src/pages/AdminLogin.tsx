import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { lovable } from "@/integrations/lovable/index";
import { useToast } from "@/hooks/use-toast";

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isAdmin, isLoading } = useAdminAuth();
  const { toast } = useToast();
  const [isSigningIn, setIsSigningIn] = useState(false);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || "/admin";

  useEffect(() => {
    if (!isLoading && isAuthenticated && isAdmin) {
      navigate(from, { replace: true });
    } else if (!isLoading && isAuthenticated && !isAdmin) {
      navigate("/admin/pending", { replace: true });
    }
  }, [isAuthenticated, isAdmin, isLoading, navigate, from]);

  const handleGoogleLogin = async () => {
    setIsSigningIn(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/admin",
      });

      if (error) {
        toast({
          title: "Login failed",
          description: error.message,
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Login failed",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsSigningIn(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md card-premium">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Admin Dashboard</CardTitle>
          <CardDescription>
            Sign in with your authorized Google account to access the enrollment dashboard
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            size="lg"
            className="w-full gap-3"
            onClick={handleGoogleLogin}
            disabled={isSigningIn}
          >
            {isSigningIn ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            )}
            Continue with Google
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Only pre-authorized users can access this dashboard.
            <br />
            Contact your administrator if you need access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
