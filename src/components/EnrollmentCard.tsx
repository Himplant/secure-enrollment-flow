import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { CountdownTimer } from "@/components/CountdownTimer";
import { CreditCard, Building2, Shield, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface EnrollmentCardProps {
  patientName?: string;
  amount: number;
  currency?: string;
  expiresAt: Date;
  status: 'created' | 'sent' | 'opened' | 'processing' | 'paid' | 'failed' | 'expired' | 'canceled';
  paymentMethod?: 'card' | 'ach';
  className?: string;
}

export function EnrollmentCard({
  patientName,
  amount,
  currency = 'usd',
  expiresAt,
  status,
  paymentMethod,
  className,
}: EnrollmentCardProps) {
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);

  const showCountdown = ['created', 'sent', 'opened'].includes(status);

  return (
    <Card className={cn("card-premium overflow-hidden", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Payment for</p>
            <CardTitle className="text-xl">
              {patientName || 'Patient Enrollment'}
            </CardTitle>
          </div>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Amount */}
        <div className="text-center py-4 bg-background/50 rounded-lg border border-border/50">
          <p className="text-sm text-muted-foreground mb-1">Amount Due</p>
          <p className="text-4xl font-bold text-foreground">{formattedAmount}</p>
        </div>

        {/* Payment method (if available) */}
        {paymentMethod && (
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
            {paymentMethod === 'card' ? (
              <CreditCard className="h-5 w-5 text-muted-foreground" />
            ) : (
              <Building2 className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">
                {paymentMethod === 'card' ? 'Credit/Debit Card' : 'Bank Transfer (ACH)'}
              </p>
              {paymentMethod === 'ach' && status === 'processing' && (
                <p className="text-xs text-processing">
                  Bank transfer in progress - typically 3-5 business days
                </p>
              )}
            </div>
          </div>
        )}

        {/* Countdown timer */}
        {showCountdown && (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Link expires in</span>
            </div>
            <CountdownTimer expiresAt={expiresAt} />
          </div>
        )}

        {/* Security note */}
        <div className="flex items-start gap-2 p-3 bg-success/5 rounded-lg border border-success/10">
          <Shield className="h-4 w-4 text-success mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Your payment is secured with 256-bit SSL encryption. 
            We never store your card or bank details.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
