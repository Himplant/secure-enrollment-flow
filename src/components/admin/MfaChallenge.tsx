import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Shield, LogOut, Smartphone } from "lucide-react";

interface MfaChallengeProps {
  userEmail: string;
  onVerified: () => void;
  onSignOut: () => void;
}

export function MfaChallenge({ userEmail, onVerified, onSignOut }: MfaChallengeProps) {
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");

  const handleTotpVerify = async () => {
    if (code.length !== 6) return;
    setIsVerifying(true);
    setError("");

    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totpFactor = factors?.totp?.[0];
      if (!totpFactor) {
        setError("No authenticator found. Please contact admin.");
        setIsVerifying(false);
        return;
      }

      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: totpFactor.id,
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totpFactor.id,
        challengeId: challenge.id,
        code,
      });
      if (verifyError) {
        setError("Invalid code. Please try again.");
        setIsVerifying(false);
        return;
      }

      onVerified();
    } catch (err: any) {
      setError(err.message || "Verification failed");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Two-Factor Authentication</CardTitle>
          <CardDescription>
            Enter the 6-digit code from your authenticator app
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-2">
            <Smartphone className="h-4 w-4" />
            <span>Authenticator App</span>
          </div>

          <Input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="text-center text-lg tracking-widest"
            autoFocus
          />

          <Button
            className="w-full"
            onClick={handleTotpVerify}
            disabled={code.length !== 6 || isVerifying}
          >
            {isVerifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Verify
          </Button>

          {error && <p className="text-sm text-destructive text-center">{error}</p>}

          <Button variant="ghost" size="sm" className="w-full gap-2 text-muted-foreground" onClick={onSignOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
