import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MfaEnrollTotp } from "./MfaEnrollTotp";

interface MfaSetupChoiceProps {
  userEmail: string;
  onComplete: (method: "totp") => void;
  onSignOut: () => void;
}

export function MfaSetupChoice({ userEmail, onComplete, onSignOut }: MfaSetupChoiceProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <div className="w-full max-w-md space-y-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Set Up Two-Factor Authentication</CardTitle>
            <CardDescription>
              MFA is required for all admin accounts. Set up your authenticator app to continue.
            </CardDescription>
          </CardHeader>
        </Card>

        <MfaEnrollTotp
          onEnrolled={() => onComplete("totp")}
          onCancel={onSignOut}
        />

        <Button variant="ghost" size="sm" className="w-full gap-2 text-muted-foreground" onClick={onSignOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
