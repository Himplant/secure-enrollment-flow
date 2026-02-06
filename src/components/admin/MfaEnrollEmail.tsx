import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface MfaEnrollEmailProps {
  onEnrolled: () => void;
  onCancel: () => void;
  userEmail: string;
}

export function MfaEnrollEmail({ onEnrolled, onCancel, userEmail }: MfaEnrollEmailProps) {
  const [code, setCode] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const sendCode = async () => {
    setIsSending(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("send-mfa-email-code", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw new Error(res.error.message || "Failed to send code");
      setCodeSent(true);
      toast({ title: "Code sent", description: `Verification code sent to ${userEmail}` });
    } catch (err: any) {
      setError(err.message || "Failed to send code");
    } finally {
      setIsSending(false);
    }
  };

  const verifyCode = async () => {
    if (code.length !== 6) return;
    setIsVerifying(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("verify-mfa-email-code", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: { code },
      });
      if (res.error) throw new Error(res.error.message || "Verification failed");
      if (res.data?.error) throw new Error(res.data.error);

      toast({ title: "Email MFA Enabled", description: "Email verification has been set up successfully." });
      onEnrolled();
    } catch (err: any) {
      setError(err.message || "Invalid or expired code");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
          <Mail className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>Set Up Email Verification</CardTitle>
        <CardDescription>
          We'll send a 6-digit code to <span className="font-medium text-foreground">{userEmail}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!codeSent ? (
          <Button className="w-full gap-2" onClick={sendCode} disabled={isSending}>
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Send Verification Code
          </Button>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Enter the 6-digit code from your email</label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="text-center text-lg tracking-widest"
              />
            </div>
            <button
              type="button"
              className="text-xs text-primary hover:underline w-full text-center"
              onClick={sendCode}
              disabled={isSending}
            >
              {isSending ? "Sending..." : "Resend code"}
            </button>
          </>
        )}

        {error && <p className="text-sm text-destructive text-center">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          {codeSent && (
            <Button
              className="flex-1 gap-2"
              onClick={verifyCode}
              disabled={code.length !== 6 || isVerifying}
            >
              {isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Verify & Enable
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
