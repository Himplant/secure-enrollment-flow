import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import {
  Clock,
  User,
  DollarSign,
  FileText,
  Shield,
  Globe,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TransactionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  enrollmentId: string;
}

interface EnrollmentDetails {
  id: string;
  patient_name: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  amount_cents: number;
  currency: string | null;
  status: string;
  payment_method_type: string | null;
  created_at: string | null;
  opened_at: string | null;
  terms_accepted_at: string | null;
  terms_accept_ip: string | null;
  terms_accept_user_agent: string | null;
  terms_version: string;
  terms_url: string;
  privacy_url: string;
  processing_at: string | null;
  paid_at: string | null;
  failed_at: string | null;
  expired_at: string | null;
  expires_at: string;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  token_last4: string;
  policy_id: string | null;
  consent_pdf_path: string | null;
}

interface EnrollmentEvent {
  id: string;
  event_type: string;
  event_data: Record<string, unknown> | null;
  created_at: string | null;
}

export function TransactionDetailsModal({
  isOpen,
  onClose,
  enrollmentId,
}: TransactionDetailsModalProps) {
  const { data: enrollment, isLoading } = useQuery({
    queryKey: ["enrollment-details", enrollmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrollments")
        .select("*")
        .eq("id", enrollmentId)
        .single();

      if (error) throw error;
      return data as EnrollmentDetails;
    },
    enabled: isOpen && !!enrollmentId,
  });

  const { data: events = [] } = useQuery({
    queryKey: ["enrollment-events", enrollmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrollment_events")
        .select("*")
        .eq("enrollment_id", enrollmentId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as EnrollmentEvent[];
    },
    enabled: isOpen && !!enrollmentId,
  });

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: enrollment?.currency || "USD",
    }).format(cents / 100);
  };

  const formatDateTime = (date: string | null) => {
    if (!date) return "—";
    return format(new Date(date), "MMM d, yyyy 'at' h:mm:ss a");
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "created":
        return <Clock className="h-4 w-4 text-primary" />;
      case "opened":
        return <User className="h-4 w-4 text-blue-500" />;
      case "terms_accepted":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "checkout_session_created":
        return <DollarSign className="h-4 w-4 text-amber-500" />;
      case "payment_completed":
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "payment_failed":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "expired":
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Transaction Details
            {enrollment && <StatusBadge status={enrollment.status as any} />}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : enrollment ? (
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Patient</p>
                <p className="font-medium">{enrollment.patient_name || "Unknown"}</p>
                {enrollment.patient_email && (
                  <p className="text-sm text-muted-foreground">{enrollment.patient_email}</p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Amount</p>
                <p className="font-medium text-lg">{formatAmount(enrollment.amount_cents)}</p>
              </div>
            </div>

            <Separator />

            {/* Timeline */}
            <div className="space-y-3">
              <h3 className="font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Timeline
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Link Created</span>
                  <span>{formatDateTime(enrollment.created_at)}</span>
                </div>
                {enrollment.opened_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Link Opened</span>
                    <span>{formatDateTime(enrollment.opened_at)}</span>
                  </div>
                )}
                {enrollment.terms_accepted_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Terms Accepted</span>
                    <span className="text-green-600">{formatDateTime(enrollment.terms_accepted_at)}</span>
                  </div>
                )}
                {enrollment.processing_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payment Processing</span>
                    <span>{formatDateTime(enrollment.processing_at)}</span>
                  </div>
                )}
                {enrollment.paid_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payment Complete</span>
                    <span className="text-green-600 font-medium">{formatDateTime(enrollment.paid_at)}</span>
                  </div>
                )}
                {enrollment.failed_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payment Failed</span>
                    <span className="text-destructive">{formatDateTime(enrollment.failed_at)}</span>
                  </div>
                )}
                {enrollment.expired_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Link Expired</span>
                    <span className="text-muted-foreground">{formatDateTime(enrollment.expired_at)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expiration Date</span>
                  <span>{formatDateTime(enrollment.expires_at)}</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Consent Record (Dispute Proof) */}
            <div className="space-y-3">
              <h3 className="font-medium flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Consent Record
                {enrollment.terms_accepted_at && (
                  <Badge variant="secondary" className="text-xs">Verified</Badge>
                )}
              </h3>
              
              {enrollment.terms_accepted_at ? (
                <div className="bg-muted/30 rounded-lg p-4 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Accepted At</span>
                    <span className="font-medium">{formatDateTime(enrollment.terms_accepted_at)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Policy Version</span>
                    <span>v{enrollment.terms_version}</span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Globe className="h-3 w-3" />
                      IP Address
                    </span>
                    <span className="font-mono text-xs">{enrollment.terms_accept_ip || "Unknown"}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">User Agent</span>
                    <p className="font-mono text-xs bg-background p-2 rounded break-all">
                      {enrollment.terms_accept_user_agent || "Unknown"}
                    </p>
                  </div>
                  <div className="flex gap-4 pt-2 flex-wrap">
                    <a
                      href={enrollment.terms_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <FileText className="h-3 w-3" />
                      View Terms
                    </a>
                    <a
                      href={enrollment.privacy_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <FileText className="h-3 w-3" />
                      View Privacy Policy
                    </a>
                    {enrollment.consent_pdf_path && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={async () => {
                          const { data } = await supabase.storage
                            .from("consent-documents")
                            .createSignedUrl(enrollment.consent_pdf_path!, 60);
                          if (data?.signedUrl) {
                            window.open(data.signedUrl, "_blank");
                          }
                        }}
                      >
                        <Download className="h-3 w-3" />
                        Download Consent PDF
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Terms not yet accepted by patient.
                </p>
              )}
            </div>

            <Separator />

            {/* Event Log */}
            <div className="space-y-3">
              <h3 className="font-medium flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Audit Log
              </h3>
              
              {events.length > 0 ? (
                <div className="space-y-2">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start gap-3 text-sm p-2 rounded hover:bg-muted/30"
                    >
                      {getEventIcon(event.event_type)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium capitalize">
                            {event.event_type.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {event.created_at ? format(new Date(event.created_at), "MMM d, h:mm:ss a") : "—"}
                          </span>
                        </div>
                        {event.event_data && Object.keys(event.event_data).length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {JSON.stringify(event.event_data)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No events recorded.</p>
              )}
            </div>

            {/* Technical Info */}
            <Separator />
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>Enrollment ID: <span className="font-mono">{enrollment.id}</span></p>
              <p>Token: <span className="font-mono">****{enrollment.token_last4}</span></p>
              {enrollment.stripe_payment_intent_id && (
                <p>Stripe Payment Intent: <span className="font-mono">{enrollment.stripe_payment_intent_id}</span></p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground py-8 text-center">
            Enrollment not found.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
