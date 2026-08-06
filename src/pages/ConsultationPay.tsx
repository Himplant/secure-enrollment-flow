import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { formatIntlMoney, COUNTRY_LABEL } from "@/lib/intlMoney";
import { IntlStatusBadge } from "@/components/intl/IntlStatusBadge";
import type { IntlPaymentStatus } from "@/lib/intlStatus";

interface ConsultationPayload {
  consultation: {
    id: string;
    amount_minor: number;
    currency: string;
    country: string;
    provider: string;
    payment_status: IntlPaymentStatus;
    expires_at: string;
    checkout_url: string | null;
  };
  clinic: { name: string; city: string | null; country: string } | null;
  surgeon: { name: string; specialty: string | null } | null;
  patient: { full_name: string; email: string | null; preferred_language: string } | null;
  policy: {
    version: string;
    terms_text: string;
    terms_url: string | null;
    privacy_url: string | null;
    cancellation_policy: string | null;
    no_show_policy: string | null;
  } | null;
}

export default function ConsultationPay() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [data, setData] = useState<ConsultationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: res, error: err } = await supabase.functions.invoke("intl-get-consultation", {
        body: { token },
      });
      if (!active) return;
      if (err || (res as { error?: string })?.error) {
        setError((res as { error?: string })?.error ?? "This link could not be opened.");
      } else {
        setData(res as ConsultationPayload);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const amount = useMemo(
    () =>
      data
        ? formatIntlMoney(data.consultation.amount_minor, data.consultation.currency)
        : "",
    [data],
  );

  const handlePay = async () => {
    setSubmitting(true);
    const { data: res, error: err } = await supabase.functions.invoke("intl-create-payment", {
      body: { token, accepted_terms: true },
    });
    setSubmitting(false);
    const payload = res as { checkout_url?: string; error?: string } | null;
    if (err || payload?.error || !payload?.checkout_url) {
      setError(payload?.error ?? "We could not start the payment. Please try again.");
      return;
    }
    window.location.href = payload.checkout_url;
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardHeader className="items-center text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <CardTitle>Link unavailable</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-muted-foreground">{error}</CardContent>
        </Card>
      </main>
    );
  }

  const { consultation, clinic, surgeon, policy } = data;
  const terminal = ["approved", "expired", "canceled", "refunded", "disputed"].includes(
    consultation.payment_status,
  );

  return (
    <main className="min-h-screen bg-background py-10 px-4">
      <div className="mx-auto max-w-xl space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">Consultation fee</h1>
          <p className="text-muted-foreground text-sm">
            Your payment goes directly to {clinic?.name ?? "the clinic"}
            {clinic?.country ? ` in ${COUNTRY_LABEL[clinic.country] ?? clinic.country}` : ""}.
          </p>
        </header>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Summary</CardTitle>
            <IntlStatusBadge kind="payment" status={consultation.payment_status} />
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Clinic" value={clinic?.name ?? "—"} />
            {surgeon && <Row label="Surgeon" value={surgeon.name} />}
            <Row label="Amount" value={amount} strong />
            <Row
              label="Link expires"
              value={new Date(consultation.expires_at).toLocaleString()}
            />
            <p className="pt-2 text-xs text-muted-foreground">
              This consultation fee is non-refundable.
            </p>
          </CardContent>
        </Card>

        {policy && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Terms (v{policy.version})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-48 overflow-y-auto rounded-md border p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                {policy.terms_text}
              </div>
              {policy.cancellation_policy && (
                <p className="text-xs text-muted-foreground">{policy.cancellation_policy}</p>
              )}
            </CardContent>
          </Card>
        )}

        {!terminal && (
          <div className="space-y-4">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={accepted}
                onCheckedChange={(v) => setAccepted(v === true)}
                className="mt-0.5"
              />
              <span>
                I accept the consultation terms and understand the fee is non-refundable.
              </span>
            </label>
            <Button
              className="w-full"
              size="lg"
              disabled={!accepted || submitting}
              onClick={handlePay}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Pay {amount}
                </>
              )}
            </Button>
            {params.get("failed") === "1" && (
              <p className="text-center text-sm text-destructive">
                The previous attempt did not complete. You can try again.
              </p>
            )}
          </div>
        )}

        {consultation.payment_status === "approved" && (
          <Button className="w-full" variant="secondary" onClick={() => navigate(`/consult/${token}/success`)}>
            View confirmation
          </Button>
        )}
      </div>
    </main>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}
