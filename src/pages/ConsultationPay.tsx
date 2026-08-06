import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SignaturePad } from "@/components/SignaturePad";
import { Loader2, ShieldCheck, AlertTriangle, Lock } from "lucide-react";
import { formatIntlMoney, COUNTRY_LABEL } from "@/lib/intlMoney";
import { IntlStatusBadge } from "@/components/intl/IntlStatusBadge";
import type { IntlPaymentStatus } from "@/lib/intlStatus";

const PROVIDER_LABEL: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  paypal: "PayPal",
  stripe_connect: "Stripe",
  test: "Sandbox simulator",
};

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
    terms_accepted_at: string | null;
    can_pay: boolean;
  };
  surgeon: { name: string; specialty: string | null; city: string | null; country: string | null } | null;
  patient: { full_name: string; email: string | null; preferred_language: string } | null;
  policy: {
    version: string;
    content_sha256: string;
    language: string;
    terms_text: string;
    terms_url: string | null;
    privacy_url: string | null;
    privacy_text: string | null;
    cancellation_policy: string | null;
    no_show_policy: string | null;
    refund_exceptions: string | null;
    frozen_at: string;
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
  const [signature, setSignature] = useState<string | null>(null);
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
    () => (data ? formatIntlMoney(data.consultation.amount_minor, data.consultation.currency) : ""),
    [data],
  );

  const handlePay = async () => {
    if (!signature) return;
    setSubmitting(true);
    const { data: res, error: err } = await supabase.functions.invoke("intl-create-payment", {
      body: { token, accepted_terms: true, signature_data: signature },
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

  const { consultation, surgeon, policy } = data;
  const terminal = ["approved", "expired", "canceled", "refunded", "disputed"].includes(
    consultation.payment_status,
  );
  const providerLabel = PROVIDER_LABEL[consultation.provider] ?? consultation.provider;
  const canSubmit = accepted && !!signature && consultation.can_pay && !submitting;

  return (
    <main className="min-h-screen bg-background py-10 px-4">
      <div className="mx-auto max-w-xl space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">Consultation fee</h1>
          <p className="text-muted-foreground text-sm">
            Your payment goes directly to {surgeon?.name ?? "your surgeon"}
            {surgeon?.country ? ` in ${COUNTRY_LABEL[surgeon.country] ?? surgeon.country}` : ""}.
          </p>
        </header>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Summary</CardTitle>
            <IntlStatusBadge kind="payment" status={consultation.payment_status} />
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Surgeon" value={surgeon?.name ?? "—"} />
            {surgeon?.city && <Row label="Location" value={surgeon.city} />}
            <Row label="Amount" value={amount} strong />
            <Row label="Paid via" value={providerLabel} />
            <Row label="Link expires" value={new Date(consultation.expires_at).toLocaleString()} />
            <p className="pt-2 text-xs text-muted-foreground">
              This consultation fee is non-refundable. This link is valid for 48 hours.
            </p>
          </CardContent>
        </Card>

        {policy ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Terms (v{policy.version})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Tabs defaultValue="terms">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="terms">Terms of Service</TabsTrigger>
                  <TabsTrigger value="privacy">Privacy Policy</TabsTrigger>
                </TabsList>
                <TabsContent value="terms" className="mt-3">
                  <ScrollArea className="h-64 w-full rounded-md border bg-background p-4">
                    <div className="text-xs whitespace-pre-wrap text-muted-foreground">
                      {policy.terms_text}
                    </div>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="privacy" className="mt-3">
                  <ScrollArea className="h-64 w-full rounded-md border bg-background p-4">
                    <div className="text-xs whitespace-pre-wrap text-muted-foreground">
                      {policy.privacy_text ??
                        (policy.privacy_url
                          ? `The privacy policy is available at ${policy.privacy_url}`
                          : "Privacy Policy not available.")}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>

              {policy.cancellation_policy && (
                <p className="text-xs text-muted-foreground">{policy.cancellation_policy}</p>
              )}
              {policy.no_show_policy && (
                <p className="text-xs text-muted-foreground">{policy.no_show_policy}</p>
              )}
              {policy.refund_exceptions && (
                <p className="text-xs text-muted-foreground">{policy.refund_exceptions}</p>
              )}

              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="h-3 w-3" />
                Locked on {new Date(policy.frozen_at).toLocaleDateString()} · {policy.content_sha256.slice(0, 12)}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              The terms for this consultation are not available yet. Please contact your surgeon's
              office to have the link reissued.
            </CardContent>
          </Card>
        )}

        {!terminal && consultation.can_pay && (
          <div className="space-y-5">
            <SignaturePad onSignatureChange={setSignature} />

            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={accepted}
                onCheckedChange={(v) => setAccepted(v === true)}
                className="mt-0.5"
              />
              <span>
                I have read and agree to the Terms of Service and Privacy Policy shown above, and I
                understand this consultation fee is non-refundable.
              </span>
            </label>

            <Button className="w-full" size="lg" disabled={!canSubmit} onClick={handlePay}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Pay {amount}
                </>
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Secure payment processed by {providerLabel}
            </p>

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
