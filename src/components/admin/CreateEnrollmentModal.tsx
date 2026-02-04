import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface CreateEnrollmentResult {
  success: boolean;
  enrollment_id: string;
  enrollment_url: string;
  expires_at: string;
  token_last4: string;
}

interface CreateEnrollmentModalProps {
  prefillData?: {
    patient_name: string;
    patient_email: string | null;
    patient_phone?: string | null;
  } | null;
  triggerButton?: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateEnrollmentModal({ prefillData, triggerButton, isOpen: controlledIsOpen, onOpenChange }: CreateEnrollmentModalProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  
  // Use controlled or uncontrolled state
  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;
  const setIsOpen = isControlled ? (open: boolean) => onOpenChange?.(open) : setInternalIsOpen;
  
  const [patientName, setPatientName] = useState(prefillData?.patient_name || "");
  const [patientEmail, setPatientEmail] = useState(prefillData?.patient_email || "");
  const [patientPhone, setPatientPhone] = useState(prefillData?.patient_phone || "");
  const [amount, setAmount] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [expiresTime, setExpiresTime] = useState("12:00");
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Set default expiration to 48 hours from now
  const setDefaultExpiration = () => {
    const now = new Date();
    now.setHours(now.getHours() + 48);
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toTimeString().slice(0, 5);
    setExpiresAt(dateStr);
    setExpiresTime(timeStr);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const expiresDateTime = new Date(`${expiresAt}T${expiresTime}`);
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-enrollment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            patient_name: patientName,
            patient_email: patientEmail || undefined,
            patient_phone: patientPhone || undefined,
            amount_cents: Math.round(parseFloat(amount) * 100),
            expires_at: expiresDateTime.toISOString(),
          }),
        }
      );

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Failed to create enrollment");
      }

      return result as CreateEnrollmentResult;
    },
    onSuccess: (data) => {
      setCreatedUrl(data.enrollment_url);
      queryClient.invalidateQueries({ queryKey: ["enrollments"] });
      queryClient.invalidateQueries({ queryKey: ["enrollment-stats"] });
      toast({
        title: "Enrollment created",
        description: "Payment link is ready to share",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create enrollment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCopyUrl = async () => {
    if (createdUrl) {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const resetForm = () => {
    setPatientName(prefillData?.patient_name || "");
    setPatientEmail(prefillData?.patient_email || "");
    setPatientPhone(prefillData?.patient_phone || "");
    setAmount("");
    setExpiresAt("");
    setExpiresTime("12:00");
    setCreatedUrl(null);
    setCopied(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    resetForm();
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setDefaultExpiration();
      // Apply prefill data when opening
      if (prefillData) {
        setPatientName(prefillData.patient_name || "");
        setPatientEmail(prefillData.patient_email || "");
        setPatientPhone(prefillData.patient_phone || "");
      }
    }
    setIsOpen(open);
    if (!open) {
      handleClose();
    }
  };

  const isValid = patientName.trim() && amount && parseFloat(amount) > 0 && expiresAt;

  return (
    <>
      {/* Only render trigger if not in controlled mode */}
      {!isControlled && (
        triggerButton || (
          <Button variant="default" size="sm" className="gap-2" onClick={() => handleOpenChange(true)}>
            <Plus className="h-4 w-4" />
            New Enrollment
          </Button>
        )
      )}
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {prefillData ? "Create Additional Enrollment" : "Create New Enrollment"}
            </DialogTitle>
            <DialogDescription>
              {prefillData 
                ? `Generate a new payment link for ${prefillData.patient_name}.`
                : "Generate a payment link for a new patient enrollment."
              }
            </DialogDescription>
          </DialogHeader>
        <DialogHeader>
          <DialogTitle>
            {prefillData ? "Create Additional Enrollment" : "Create New Enrollment"}
          </DialogTitle>
          <DialogDescription>
            {prefillData 
              ? `Generate a new payment link for ${prefillData.patient_name}.`
              : "Generate a payment link for a new patient enrollment."
            }
          </DialogDescription>
        </DialogHeader>

        {createdUrl ? (
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-success/10 border border-success/20 p-4">
              <p className="text-sm font-medium text-success mb-2">Payment link created!</p>
              <div className="flex gap-2">
                <Input
                  value={createdUrl}
                  readOnly
                  className="text-xs"
                />
                <Button size="icon" variant="outline" onClick={handleCopyUrl}>
                  {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={() => {
                setCreatedUrl(null);
                setAmount("");
                setDefaultExpiration();
              }}>
                Create Another
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="patient-name">Patient Name *</Label>
                <Input
                  id="patient-name"
                  placeholder="John Doe"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="patient-email">Email (optional)</Label>
                <Input
                  id="patient-email"
                  type="email"
                  placeholder="patient@example.com"
                  value={patientEmail}
                  onChange={(e) => setPatientEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="patient-phone">Phone (optional)</Label>
                <Input
                  id="patient-phone"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount (USD) *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="1000.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="pl-7"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="expires-date">Expiration Date *</Label>
                  <Input
                    id="expires-date"
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expires-time">Time</Label>
                  <Input
                    id="expires-time"
                    type="time"
                    value={expiresTime}
                    onChange={(e) => setExpiresTime(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                onClick={() => createMutation.mutate()} 
                disabled={!isValid || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Create Enrollment
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
