import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Smartphone, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface MfaEnrollTotpProps {
  onEnrolled: () => void;
  onCancel: () => void;
}

export function MfaEnrollTotp({ onEnrolled, onCancel }: MfaEnrollTotpProps) {
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator App",
      });
      if (error) {
        setError(error.message);
        setIsLoading(false);
        return;
      }
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFactorId(data.id);
      setIsLoading(false);
    })();
  }, []);

  const handleVerify = async () => {
    if (verifyCode.length !== 6) return;
    setIsVerifying(true);
    setError("");

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId,
    });
    if (challengeError) {
      setError(challengeError.message);
      setIsVerifying(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: verifyCode,
    });
    if (verifyError) {
      setError("Invalid code. Please try again.");
      setIsVerifying(false);
      return;
    }

    toast({ title: "MFA Enabled", description: "Authenticator app has been set up successfully." });
    onEnrolled();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
          <Smartphone className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>Set Up Authenticator App</CardTitle>
        <CardDescription>
          Scan the QR code with Google Authenticator, Authy, or any TOTP app
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {qrCode && (
          <div className="flex justify-center">
            <img src={qrCode} alt="QR Code" className="w-48 h-48 rounded-lg border" />
          </div>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Can't scan? Enter manually</summary>
          <code className="block mt-2 p-2 bg-muted rounded text-xs break-all select-all">{secret}</code>
        </details>

        <div className="space-y-2">
          <label className="text-sm font-medium">Enter the 6-digit code from your app</label>
          <Input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
            className="text-center text-lg tracking-widest"
          />
        </div>

        {error && <p className="text-sm text-destructive text-center">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="flex-1 gap-2"
            onClick={handleVerify}
            disabled={verifyCode.length !== 6 || isVerifying}
          >
            {isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Verify & Enable
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
