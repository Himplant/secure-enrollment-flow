import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, Shield, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface TermsConsentProps {
  termsUrl: string;
  privacyUrl: string;
  termsText?: string | null;
  privacyText?: string | null;
  termsVersion: string;
  onAccept: () => void;
  isLoading?: boolean;
  className?: string;
}

export function TermsConsent({
  termsUrl,
  privacyUrl,
  termsText,
  privacyText,
  termsVersion,
  onAccept,
  isLoading = false,
  className,
}: TermsConsentProps) {
  const [accepted, setAccepted] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const hasFullText = termsText || privacyText;

  return (
    <div className={cn("space-y-6", className)}>
      {/* Legal documents section */}
      <div className="bg-muted/30 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileText className="h-4 w-4" />
            <span>Review Terms & Privacy Policy</span>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="px-4 pb-4">
            {hasFullText ? (
              <Tabs defaultValue="terms" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="terms">Terms of Service</TabsTrigger>
                  <TabsTrigger value="privacy">Privacy Policy</TabsTrigger>
                </TabsList>
                <TabsContent value="terms" className="mt-3">
                  <ScrollArea className="h-64 w-full rounded-md border bg-background p-4">
                    <div className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                      {termsText || "Terms of Service not available."}
                    </div>
                  </ScrollArea>
                  {termsUrl && (
                    <a
                      href={termsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 underline underline-offset-4 transition-colors mt-2"
                    >
                      View full document
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </TabsContent>
                <TabsContent value="privacy" className="mt-3">
                  <ScrollArea className="h-64 w-full rounded-md border bg-background p-4">
                    <div className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                      {privacyText || "Privacy Policy not available."}
                    </div>
                  </ScrollArea>
                  {privacyUrl && (
                    <a
                      href={privacyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 underline underline-offset-4 transition-colors mt-2"
                    >
                      View full document
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              <div className="flex flex-wrap gap-3 pt-2">
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
            )}

            <p className="text-xs text-muted-foreground mt-3">
              Version: {termsVersion}
            </p>
          </div>
        )}
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
