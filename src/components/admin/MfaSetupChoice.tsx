import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Smartphone, Mail, LogOut } from "lucide-react";
import { MfaEnrollTotp } from "./MfaEnrollTotp";
import { MfaEnrollEmail } from "./MfaEnrollEmail";

interface MfaSetupChoiceProps {
  userEmail: string;
  onComplete: (method: "totp" | "email") => void;
  onSignOut: () => void;
}

export function MfaSetupChoice({ userEmail, onComplete, onSignOut }: MfaSetupChoiceProps) {
  const [selectedMethod, setSelectedMethod] = useState<"totp" | "email" | null>(null);

  if (selectedMethod === "totp") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
        <MfaEnrollTotp
          onEnrolled={() => onComplete("totp")}
          onCancel={() => setSelectedMethod(null)}
        />
      </div>
    );
  }

  if (selectedMethod === "email") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
        <MfaEnrollEmail
          userEmail={userEmail}
          onEnrolled={() => onComplete("email")}
          onCancel={() => setSelectedMethod(null)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Set Up Two-Factor Authentication</CardTitle>
          <CardDescription>
            MFA is required for all admin accounts. Choose your preferred verification method.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            size="lg"
            className="w-full justify-start gap-3 h-auto py-4"
            onClick={() => setSelectedMethod("totp")}
          >
            <Smartphone className="h-5 w-5 text-primary shrink-0" />
            <div className="text-left">
              <div className="font-medium">Authenticator App</div>
              <div className="text-xs text-muted-foreground">Google Authenticator, Authy, etc. (Most secure)</div>
            </div>
          </Button>

          <Button
            variant="outline"
            size="lg"
            className="w-full justify-start gap-3 h-auto py-4"
            onClick={() => setSelectedMethod("email")}
          >
            <Mail className="h-5 w-5 text-primary shrink-0" />
            <div className="text-left">
              <div className="font-medium">Email Code</div>
              <div className="text-xs text-muted-foreground">Receive a code at {userEmail}</div>
            </div>
          </Button>

          <Button variant="ghost" size="sm" className="w-full gap-2 text-muted-foreground mt-2" onClick={onSignOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
