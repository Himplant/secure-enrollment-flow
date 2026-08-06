import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toMinor, COUNTRY_LABEL } from "@/lib/intlMoney";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateConsultationModal({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const [clinicId, setClinicId] = useState("");
  const [surgeonId, setSurgeonId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const { data: clinics } = useQuery({
    queryKey: ["intl-clinics-active"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name, country, default_currency")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: clinicSurgeons } = useQuery({
    queryKey: ["intl-clinic-surgeons", clinicId],
    enabled: open && !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinic_surgeons")
        .select("surgeon_id, consultation_fee_minor, surgeon:surgeons(name)")
        .eq("clinic_id", clinicId)
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const clinic = (clinics ?? []).find((c) => c.id === clinicId);
  const currency = clinic?.default_currency ?? "USD";

  const reset = () => {
    setClinicId("");
    setSurgeonId("");
    setName("");
    setEmail("");
    setPhone("");
    setAmount("");
    setLink(null);
  };

  const submit = async () => {
    if (!clinicId || !name.trim() || !amount) {
      toast({ title: "Clinic, patient name and amount are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("intl-create-consultation", {
      body: {
        clinic_id: clinicId,
        surgeon_id: surgeonId || null,
        patient_name: name.trim(),
        patient_email: email.trim() || null,
        patient_phone: phone.trim() || null,
        amount_minor: toMinor(Number(amount), currency),
        currency,
      },
    });
    setSubmitting(false);

    const payload = data as { payment_url?: string; error?: string } | null;
    if (error || payload?.error) {
      toast({
        title: "Could not create the link",
        description: payload?.error ?? error?.message,
        variant: "destructive",
      });
      return;
    }
    setLink(payload?.payment_url ?? null);
    onCreated();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New consultation payment link</DialogTitle>
          <DialogDescription>
            The fee is collected directly by the clinic through its own connected payment account.
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="space-y-3">
            <Label>Payment link</Label>
            <div className="flex gap-2">
              <Input readOnly value={link} />
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(link);
                  toast({ title: "Link copied" });
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This link is shown once. Copy it before closing this dialog.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Clinic</Label>
              <Select value={clinicId} onValueChange={setClinicId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a clinic" />
                </SelectTrigger>
                <SelectContent>
                  {(clinics ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} — {COUNTRY_LABEL[c.country] ?? c.country}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {clinicId && (clinicSurgeons ?? []).length > 0 && (
              <div className="space-y-2">
                <Label>Surgeon (optional)</Label>
                <Select value={surgeonId} onValueChange={setSurgeonId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a surgeon" />
                  </SelectTrigger>
                  <SelectContent>
                    {(clinicSurgeons ?? []).map((cs) => (
                      <SelectItem key={cs.surgeon_id} value={cs.surgeon_id as string}>
                        {(cs as { surgeon?: { name?: string } }).surgeon?.name ?? "Surgeon"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Patient name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Amount ({currency})</Label>
                <Input
                  type="number"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {link ? (
            <Button
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Done
            </Button>
          ) : (
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create link"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
