import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

/**
 * Portal TOTP enrolment + challenge.
 *
 * Deliberately separate from the admin MFA components so no international
 * change can weaken the Himplant admin AAL2 path.
 */
export default function PortalMfa() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"enroll" | "challenge">("enroll");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = factors?.totp?.find((f) => f.status === "verified");
    if (verified) {
      setMode("challenge");
      setFactorId(verified.id);
      setLoading(false);
      return;
    }
    // Clean up any half-finished enrolment so a retry always works.
    for (const f of factors?.totp ?? []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setMode("enroll");
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setLoading(false);
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
    if (cErr || !challenge) {
      setBusy(false);
      return toast.error(cErr?.message ?? "Could not start the challenge");
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Two-factor authentication verified");
    navigate("/portal", { replace: true });
  };

  if (loading) {
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
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>
            {mode === "enroll" ? "Set up two-factor authentication" : "Two-factor verification"}
          </CardTitle>
          <CardDescription>
            {mode === "enroll"
              ? "Scan the code with your authenticator app, then enter the 6-digit code."
              : "Enter the 6-digit code from your authenticator app."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "enroll" && qr && (
            <div className="space-y-3 text-center">
              <img src={qr} alt="Two-factor authentication QR code" className="mx-auto h-44 w-44" />
              {secret && (
                <p className="text-xs text-muted-foreground break-all">
                  Manual key: <span className="font-mono">{secret}</span>
                </p>
              )}
            </div>
          )}
          <form onSubmit={verify} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Authentication code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Verify
            </Button>
          </form>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate("/portal/login", { replace: true });
            }}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
