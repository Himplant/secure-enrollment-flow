import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2 } from "lucide-react";
import { formatIntlMoney } from "@/lib/intlMoney";

export default function ConsultationSuccess() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<{
    consultation?: { amount_minor: number; currency: string; payment_status: string };
    surgeon?: { name: string } | null;
  } | null>(null);

  useEffect(() => {
    supabase.functions
      .invoke("intl-get-consultation", { body: { token } })
      .then(({ data: res }) => setData(res as typeof data));
  }, [token]);

  if (!data?.consultation) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="max-w-md w-full">
        <CardHeader className="items-center text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 text-success" />
          <CardTitle>Payment confirmed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-center text-sm text-muted-foreground">
          <p className="text-base font-semibold text-foreground">
            {formatIntlMoney(data.consultation.amount_minor, data.consultation.currency)}
          </p>
          <p>
            Your consultation fee has been paid directly to{" "}
            {data.surgeon?.name ?? "your surgeon"}.
          </p>
          <p>
            The surgeon’s team will contact you shortly to schedule your consultation. Keep this
            confirmation for your records.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
