import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { EnrollmentCard } from "@/components/EnrollmentCard";
import { TermsConsent } from "@/components/TermsConsent";
import { EnrollmentStatus } from "@/components/EnrollmentStatus";
import { Shield } from "lucide-react";

// Mock data for demonstration - will be replaced with API calls
const mockEnrollment = {
  id: "demo-enrollment-id",
  patientName: "John Smith",
  amount: 125000, // $1,250.00 in cents
  currency: "usd",
  status: "opened" as const,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
  termsVersion: "1.0.0",
  termsUrl: "#terms",
  privacyUrl: "#privacy",
};

type PageState = 'loading' | 'enrollment' | 'processing' | 'success' | 'ach-processing' | 'failed' | 'expired' | 'invalid';

export default function EnrollPage() {
  const { token } = useParams<{ token: string }>();
  const [pageState, setPageState] = useState<PageState>('loading');
  const [enrollment, setEnrollment] = useState(mockEnrollment);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Simulate loading and validation
    const timer = setTimeout(() => {
      if (!token) {
        setPageState('invalid');
        return;
      }
      // In production, this would fetch the enrollment from the API
      setPageState('enrollment');
    }, 1000);

    return () => clearTimeout(timer);
  }, [token]);

  const handleAcceptTerms = async () => {
    setIsSubmitting(true);
    
    // Simulate API call to create checkout session
    setTimeout(() => {
      // In production, this would redirect to Stripe Checkout
      // For demo, we'll show the success state
      setIsSubmitting(false);
      setPageState('success');
    }, 2000);
  };

  const handleExpire = () => {
    setPageState('expired');
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

  if (pageState === 'success') {
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
  return (
    <div className="min-h-screen bg-background safe-area-inset">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="font-semibold text-foreground">Secure Payment</span>
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

          {/* Enrollment card */}
          <EnrollmentCard
            patientName={enrollment.patientName}
            amount={enrollment.amount}
            currency={enrollment.currency}
            expiresAt={enrollment.expiresAt}
            status={enrollment.status}
          />

          {/* Terms and payment button */}
          <div className="card-premium p-6">
            <TermsConsent
              termsUrl={enrollment.termsUrl}
              privacyUrl={enrollment.privacyUrl}
              termsVersion={enrollment.termsVersion}
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
            Questions? Contact our support team at{" "}
            <a href="mailto:support@example.com" className="text-primary hover:underline">
              support@example.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
