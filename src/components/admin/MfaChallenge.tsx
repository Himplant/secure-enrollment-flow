import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Shield, LogOut } from "lucide-react";

interface MfaChallengeProps {
  mfaMethod: "totp" | "email";
  userEmail: string;
  onVerified: () => void;
  onSignOut: () => void;
}

export function MfaChallenge({ mfaMethod, userEmail, onVerified, onSignOut }: MfaChallengeProps) {
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [emailCodeSent, setEmailCodeSent] = useState(false);
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

  const sendEmailCode = async () => {
    setIsSending(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("send-mfa-email-code", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw new Error(res.error.message);
      setEmailCodeSent(true);
    } catch (err: any) {
      setError(err.message || "Failed to send code");
    } finally {
      setIsSending(false);
    }
  };

  const handleEmailVerify = async () => {
    if (code.length !== 6) return;
    setIsVerifying(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("verify-mfa-email-code", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: { code },
      });
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      onVerified();
    } catch (err: any) {
      setError(err.message || "Invalid or expired code");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerify = mfaMethod === "totp" ? handleTotpVerify : handleEmailVerify;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Two-Factor Authentication</CardTitle>
          <CardDescription>
            {mfaMethod === "totp"
              ? "Enter the code from your authenticator app"
              : `We'll send a code to ${userEmail}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mfaMethod === "email" && !emailCodeSent ? (
            <Button className="w-full" onClick={sendEmailCode} disabled={isSending}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Send Code to Email
            </Button>
          ) : (
            <>
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
              {mfaMethod === "email" && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline w-full text-center"
                  onClick={sendEmailCode}
                  disabled={isSending}
                >
                  {isSending ? "Sending..." : "Resend code"}
                </button>
              )}
              <Button
                className="w-full"
                onClick={handleVerify}
                disabled={code.length !== 6 || isVerifying}
              >
                {isVerifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Verify
              </Button>
            </>
          )}

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
