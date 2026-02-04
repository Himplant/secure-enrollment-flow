import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2, Copy, Check } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface RegenerateLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  enrollment: {
    id: string;
    patient_name: string | null;
    status: string;
    policy_id?: string | null;
  };
}

interface RegenerateResult {
  success: boolean;
  enrollment_id: string;
  enrollment_url: string;
  expires_at: string;
  token_last4: string;
}

interface Policy {
  id: string;
  name: string;
  version: string;
  is_default: boolean;
  is_active: boolean;
}

export function RegenerateLinkModal({ isOpen, onClose, enrollment }: RegenerateLinkModalProps) {
  const [expiresAt, setExpiresAt] = useState("");
  const [expiresTime, setExpiresTime] = useState("12:00");
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch active policies
  const { data: policies = [] } = useQuery({
    queryKey: ["policies-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select("id, name, version, is_default, is_active")
        .eq("is_active", true)
        .order("is_default", { ascending: false });
      
      if (error) throw error;
      return data as Policy[];
    },
  });

  const defaultPolicy = policies.find(p => p.is_default);

  // Set default expiration to 48 hours from now
  const setDefaultExpiration = () => {
    const now = new Date();
    now.setHours(now.getHours() + 48);
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toTimeString().slice(0, 5);
    setExpiresAt(dateStr);
    setExpiresTime(timeStr);
  };

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const expiresDateTime = new Date(`${expiresAt}T${expiresTime}`);
      const policyToUse = selectedPolicyId || enrollment.policy_id || defaultPolicy?.id;
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/regenerate-enrollment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            enrollment_id: enrollment.id,
            expires_at: expiresDateTime.toISOString(),
            policy_id: policyToUse,
          }),
        }
      );

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Failed to regenerate enrollment");
      }

      return result as RegenerateResult;
    },
    onSuccess: (data) => {
      setCreatedUrl(data.enrollment_url);
      queryClient.invalidateQueries({ queryKey: ["enrollments"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["enrollment-stats"] });
      toast({
        title: "Link regenerated",
        description: "New payment link is ready to share",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to regenerate link",
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

  const handleClose = () => {
    setExpiresAt("");
    setExpiresTime("12:00");
    setSelectedPolicyId("");
    setCreatedUrl(null);
    setCopied(false);
    onClose();
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setDefaultExpiration();
      // Set initial policy from enrollment or default
      if (enrollment.policy_id) {
        setSelectedPolicyId(enrollment.policy_id);
      } else if (defaultPolicy) {
        setSelectedPolicyId(defaultPolicy.id);
      }
    } else {
      handleClose();
    }
  };

  // Initialize expiration on open
  if (isOpen && !expiresAt) {
    setDefaultExpiration();
    if (!selectedPolicyId) {
      if (enrollment.policy_id) {
        setSelectedPolicyId(enrollment.policy_id);
      } else if (defaultPolicy) {
        setSelectedPolicyId(defaultPolicy.id);
      }
    }
  }

  const isValid = expiresAt && (selectedPolicyId || enrollment.policy_id || defaultPolicy);
  const noPoliciesConfigured = policies.length === 0;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Regenerate Payment Link
          </DialogTitle>
          <DialogDescription>
            Generate a new payment link for <strong>{enrollment.patient_name || "Unknown"}</strong>.
            The previous link will no longer work.
          </DialogDescription>
        </DialogHeader>

        {createdUrl ? (
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-success/10 border border-success/20 p-4">
              <p className="text-sm font-medium text-success mb-2">New payment link created!</p>
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
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="text-muted-foreground">
                  Current status: <span className="font-medium text-foreground">{enrollment.status}</span>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="expires-date">New Expiration Date *</Label>
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

              {/* Policy Selection */}
              <div className="space-y-2">
                <Label htmlFor="policy">Payment Policy *</Label>
                {noPoliciesConfigured ? (
                  <p className="text-sm text-destructive">
                    No policies configured. Please create a policy first in the Policies tab.
                  </p>
                ) : (
                  <Select 
                    value={selectedPolicyId || enrollment.policy_id || defaultPolicy?.id || ""} 
                    onValueChange={setSelectedPolicyId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a policy" />
                    </SelectTrigger>
                    <SelectContent>
                      {policies.map((policy) => (
                        <SelectItem key={policy.id} value={policy.id}>
                          {policy.name} (v{policy.version})
                          {policy.is_default && " — Default"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                onClick={() => regenerateMutation.mutate()} 
                disabled={!isValid || regenerateMutation.isPending || noPoliciesConfigured}
              >
                {regenerateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Regenerate Link
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
