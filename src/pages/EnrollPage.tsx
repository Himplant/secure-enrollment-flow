import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { EnrollmentCard } from "@/components/EnrollmentCard";
import { TermsConsent } from "@/components/TermsConsent";
import { EnrollmentStatus } from "@/components/EnrollmentStatus";
import { Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import himplantLogo from "@/assets/himplant-logo.png";

// Secure enrollment data - only non-sensitive fields from edge function
interface EnrollmentData {
  id: string;
  patient_first_name: string | null;
  patient_name: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  surgeon_name: string | null;
  amount_cents: number;
  currency: string | null;
  status: string;
  expires_at: string;
  terms_version: string;
  terms_url: string;
  privacy_url: string;
  terms_text: string | null;
  privacy_text: string | null;
  terms_sha256: string;
  opened_at: string | null;
  terms_accepted_at: string | null;
}

type PageState = 'loading' | 'enrollment' | 'processing' | 'success' | 'ach-processing' | 'failed' | 'expired' | 'invalid' | 'already-paid';

export default function EnrollPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const [pageState, setPageState] = useState<PageState>('loading');
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check for return status from Stripe
  const returnStatus = searchParams.get('status');

  useEffect(() => {
    const loadEnrollment = async () => {
      if (!token) {
        setPageState('invalid');
        return;
      }

      try {
        // SECURITY: Fetch enrollment via secure edge function (not direct DB access)
        // This prevents exposing sensitive PII through client-side queries
        const { data, error: invokeError } = await supabase.functions.invoke('get-enrollment', {
          body: { token },
        });

        if (invokeError) {
          console.error("Failed to fetch enrollment:", invokeError);
          setPageState('invalid');
          return;
        }

        if (data?.error) {
          console.error("Enrollment error:", data.error);
          setPageState('invalid');
          return;
        }

        const enrollmentData = data as EnrollmentData;
        setEnrollment(enrollmentData);

        // Handle return from Stripe
        if (returnStatus === 'success') {
          // Payment completed - check status
          if (enrollmentData.status === 'paid') {
            setPageState('success');
          } else if (enrollmentData.status === 'processing') {
            setPageState('ach-processing');
          } else {
            // Refresh to get latest status
            setPageState('success');
          }
          return;
        }

        if (returnStatus === 'canceled') {
          // User canceled - show enrollment form again
          setPageState('enrollment');
          return;
        }

        // Check enrollment status - edge function handles expiry and opened_at
        switch (enrollmentData.status) {
          case 'paid':
            setPageState('already-paid');
            break;
          case 'processing':
            setPageState('ach-processing');
            break;
          case 'failed':
            setPageState('failed');
            break;
          case 'expired':
            setPageState('expired');
            break;
          case 'canceled':
            setPageState('invalid');
            break;
          default:
            setPageState('enrollment');
        }
      } catch (err) {
        console.error("Error loading enrollment:", err);
        setPageState('invalid');
      }
    };

    loadEnrollment();
  }, [token, returnStatus]);

  const handleAcceptTerms = async (signatureDataUrl: string) => {
    if (!token || !enrollment) return;
    
    setIsSubmitting(true);
    setError(null);

    try {
      // Call the create-checkout-session edge function
      const { data, error: invokeError } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          token: token,
          terms_accepted: true,
          consent_user_agent: navigator.userAgent,
          signature_data: signatureDataUrl,
        },
      });

      if (invokeError) {
        throw new Error(invokeError.message || 'Failed to create checkout session');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      if (data?.checkout_url) {
        // Redirect to Stripe Checkout
        window.location.href = data.checkout_url;
      } else {
        throw new Error('No checkout URL received');
      }
    } catch (err) {
      console.error("Error creating checkout session:", err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center animate-fade-in">
           <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
             <Shield className="h-8 w-8 text-primary animate-pulse" />
           </div>
          <p className="text-muted-foreground">Loading secure payment...</p>
        </div>
      </div>
    );
  }

  // Invalid/expired/failed states
  if (pageState === 'invalid') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <EnrollmentStatus
          type="invalid"
          title="Invalid Payment Link"
          message="This payment link is not valid. Please check the link and try again, or contact support if you believe this is an error."
        />
      </div>
    );
  }

  if (pageState === 'expired') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <EnrollmentStatus
          type="expired"
          title="Link Expired"
          message="This payment link has expired. For security reasons, payment links are only valid for 48 hours. Please contact us to receive a new payment link."
        />
      </div>
    );
  }

  if (pageState === 'failed') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <EnrollmentStatus
          type="failed"
          title="Payment Failed"
          message="We were unable to process your payment. Please try again or use a different payment method. If the problem persists, please contact support."
          actionLabel="Try Again"
          onAction={() => setPageState('enrollment')}
        />
      </div>
    );
  }

  if (pageState === 'success' || pageState === 'already-paid') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <EnrollmentStatus
          type="success"
          title="Payment Successful"
          message="Thank you! Your payment has been processed successfully. You will receive a confirmation email shortly with your receipt and next steps."
        />
      </div>
    );
  }

  if (pageState === 'ach-processing') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <EnrollmentStatus
          type="processing"
          title="Bank Transfer Initiated"
          message="Your bank transfer (ACH) is being processed. This typically takes 3-5 business days. You will receive an email confirmation once the payment is complete."
        />
      </div>
    );
  }

  // Main enrollment form
  if (!enrollment) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <EnrollmentStatus
          type="invalid"
          title="Error Loading Enrollment"
          message="Unable to load enrollment details. Please try refreshing the page."
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background safe-area-inset">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-center gap-3">
            <img src={himplantLogo} alt="Himplant" className="h-10 w-auto object-contain" />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container max-w-2xl mx-auto px-4 py-8 animate-fade-in">
        <div className="space-y-8">
          {/* Welcome message */}
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold text-foreground">
              Complete Your Enrollment
            </h1>
            <p className="text-muted-foreground">
              Review the details below and complete your secure payment
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-center">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}

          {/* Enrollment card */}
          <EnrollmentCard
            patientName={enrollment.patient_first_name || "Patient"}
            amount={enrollment.amount_cents}
            currency={enrollment.currency || "usd"}
            expiresAt={new Date(enrollment.expires_at)}
            status={enrollment.status as "created" | "sent" | "opened" | "processing" | "paid" | "failed" | "expired" | "canceled"}
          />

          {/* Terms and payment button */}
          <div className="card-premium p-6">
            <TermsConsent
              termsUrl={enrollment.terms_url}
              privacyUrl={enrollment.privacy_url}
              termsText={enrollment.terms_text}
              privacyText={enrollment.privacy_text}
              termsVersion={enrollment.terms_version}
              placeholderData={{
                patient_name: enrollment.patient_name,
                patient_email: enrollment.patient_email,
                patient_phone: enrollment.patient_phone,
                amount_cents: enrollment.amount_cents,
                currency: enrollment.currency || "usd",
                surgeon_name: enrollment.surgeon_name,
                expires_at: enrollment.expires_at,
              }}
              onAccept={handleAcceptTerms}
              isLoading={isSubmitting}
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-auto">
        <div className="container max-w-2xl mx-auto px-4 py-6">
          <p className="text-xs text-center text-muted-foreground">
            © {new Date().getFullYear()} Himplant. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
