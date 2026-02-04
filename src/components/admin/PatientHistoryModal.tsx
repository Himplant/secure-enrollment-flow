import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, DollarSign, Calendar, CreditCard, Building2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Patient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface Enrollment {
  id: string;
  amount_cents: number;
  status: string;
  payment_method_type: string | null;
  created_at: string | null;
  paid_at: string | null;
  expires_at: string;
  token_last4: string;
}

interface PatientHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: Patient;
}

export function PatientHistoryModal({ isOpen, onClose, patient }: PatientHistoryModalProps) {
  const { data: enrollments, isLoading } = useQuery({
    queryKey: ["patient-enrollments", patient.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrollments")
        .select("id, amount_cents, status, payment_method_type, created_at, paid_at, expires_at, token_last4")
        .eq("patient_id", patient.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Enrollment[];
    },
    enabled: isOpen,
  });

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const totalPaid = enrollments
    ?.filter((e) => e.status === "paid")
    .reduce((sum, e) => sum + e.amount_cents, 0) || 0;

  const totalPending = enrollments
    ?.filter((e) => ["created", "sent", "opened", "processing"].includes(e.status))
    .reduce((sum, e) => sum + e.amount_cents, 0) || 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Payment History</DialogTitle>
          <DialogDescription>
            Transaction history for {patient.name}
            {patient.email && ` (${patient.email})`}
          </DialogDescription>
        </DialogHeader>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 py-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Paid</p>
            <p className="text-2xl font-semibold text-success">{formatAmount(totalPaid)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending</p>
            <p className="text-2xl font-semibold text-warning">{formatAmount(totalPending)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Transactions</p>
            <p className="text-2xl font-semibold">{enrollments?.length || 0}</p>
          </div>
        </div>

        {/* Transaction List */}
        <ScrollArea className="h-[400px] pr-4">
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !enrollments || enrollments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No transactions found for this patient.
            </div>
          ) : (
            <div className="space-y-3">
              {enrollments.map((enrollment) => (
                <div
                  key={enrollment.id}
                  className="rounded-lg border bg-card/50 p-4 hover:bg-card transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold">
                          {formatAmount(enrollment.amount_cents)}
                        </span>
                        <StatusBadge status={enrollment.status as any} />
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {enrollment.created_at
                            ? format(new Date(enrollment.created_at), "MMM d, yyyy 'at' h:mm a")
                            : "—"}
                        </div>
                        {enrollment.payment_method_type && (
                          <div className="flex items-center gap-1">
                            {enrollment.payment_method_type === "card" ? (
                              <CreditCard className="h-3.5 w-3.5" />
                            ) : (
                              <Building2 className="h-3.5 w-3.5" />
                            )}
                            {enrollment.payment_method_type === "card" ? "Card" : "ACH"}
                          </div>
                        )}
                        {enrollment.paid_at && (
                          <div className="flex items-center gap-1 text-success">
                            <DollarSign className="h-3.5 w-3.5" />
                            Paid {format(new Date(enrollment.paid_at), "MMM d, yyyy")}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground font-mono">
                        ****{enrollment.token_last4}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
