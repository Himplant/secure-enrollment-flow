import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ExternalLink, Shield, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface TermsConsentProps {
  termsUrl: string;
  privacyUrl: string;
  termsVersion: string;
  onAccept: () => void;
  isLoading?: boolean;
  className?: string;
}

export function TermsConsent({
  termsUrl,
  privacyUrl,
  termsVersion,
  onAccept,
  isLoading = false,
  className,
}: TermsConsentProps) {
  const [accepted, setAccepted] = useState(false);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Legal documents section */}
      <div className="bg-muted/30 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FileText className="h-4 w-4" />
          <span>Please review before proceeding</span>
        </div>
        
        <div className="flex flex-wrap gap-3">
          <a
            href={termsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 underline underline-offset-4 transition-colors"
          >
            Terms of Service
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <span className="text-muted-foreground">·</span>
          <a
            href={privacyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 underline underline-offset-4 transition-colors"
          >
            Privacy Policy
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        
        <p className="text-xs text-muted-foreground">
          Version: {termsVersion}
        </p>
      </div>

      {/* Consent checkbox */}
      <div className="flex items-start gap-3">
        <Checkbox
          id="terms-consent"
          checked={accepted}
          onCheckedChange={(checked) => setAccepted(checked === true)}
          className="mt-1 h-5 w-5 rounded border-2 border-primary/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
        />
        <label
          htmlFor="terms-consent"
          className="text-sm text-foreground leading-relaxed cursor-pointer"
        >
          I have read and agree to the{" "}
          <span className="font-medium">Terms of Service</span> and{" "}
          <span className="font-medium">Privacy Policy</span>. I understand that 
          by proceeding, I am authorizing this payment.
        </label>
      </div>

      {/* Continue button */}
      <Button
        variant="hero"
        size="xl"
        className="w-full"
        onClick={onAccept}
        disabled={!accepted || isLoading}
      >
        {isLoading ? (
          <>
            <span className="animate-spin mr-2">◌</span>
            Processing...
          </>
        ) : (
          <>
            <Shield className="h-5 w-5 mr-2" />
            Continue to Secure Payment
          </>
        )}
      </Button>

      {/* Trust indicators */}
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Shield className="h-3.5 w-3.5" />
          256-bit SSL
        </span>
        <span>·</span>
        <span>Powered by Stripe</span>
        <span>·</span>
        <span>HIPAA Compliant</span>
      </div>
    </div>
  );
}
