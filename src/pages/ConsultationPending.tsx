import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

/**
 * Waiting room after the patient returns from the provider. A browser redirect
 * is never proof of payment — this page only polls the server, which is
 * updated exclusively by the verified provider webhook.
 */
export default function ConsultationPending() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>("processing");

  useEffect(() => {
    let active = true;
    let attempts = 0;

    const poll = async () => {
      const { data } = await supabase.functions.invoke("intl-get-consultation", {
        body: { token },
      });
      if (!active) return;
      const current = (data as { consultation?: { payment_status?: string } })?.consultation
        ?.payment_status;
      if (current) setStatus(current);
      if (current === "approved") {
        navigate(`/consult/${token}/success`, { replace: true });
        return;
      }
      if (["failed", "expired", "canceled"].includes(current ?? "")) {
        navigate(`/consult/${token}?failed=1`, { replace: true });
        return;
      }
      attempts += 1;
      if (attempts < 40) setTimeout(poll, 3000);
    };

    poll();
    return () => {
      active = false;
    };
  }, [token, navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="max-w-md w-full">
        <CardHeader className="items-center text-center space-y-3">
          <Loader2 className="h-9 w-9 animate-spin text-primary" />
          <CardTitle>Confirming your payment</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground space-y-2">
          <p>
            We are waiting for the payment provider to confirm the transaction. This page updates
            automatically — please keep it open.
          </p>
          <p className="text-xs">Current status: {status}</p>
        </CardContent>
      </Card>
    </main>
  );
}
