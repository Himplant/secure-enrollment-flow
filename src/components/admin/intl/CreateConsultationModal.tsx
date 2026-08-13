import { useMemo, useState } from "react";
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
import { toMinor, fromMinor, COUNTRY_LABEL } from "@/lib/intlMoney";
import { useIntlNetwork } from "./hub/useIntlNetwork";
import {
  computeSurgeonReadiness,
  paymentState,
  portalAccessState,
  type NetworkSurgeon,
} from "@/lib/intlNetwork";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface SurgeonOption {
  surgeon: NetworkSurgeon;
  /** Country default currency resolved from country settings, never USD. */
  currency: string;
  ready: boolean;
  reason: string;
}

export function CreateConsultationModal({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const { data } = useIntlNetwork();
  const [surgeonId, setSurgeonId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const options = useMemo<SurgeonOption[]>(() => {
    if (!data) return [];
    const settings = Object.fromEntries(data.country_settings.map((c) => [c.country, c]));
    return data.surgeons
      .filter((s) => s.is_active)
      .map((s) => {
        const setting = settings[s.country ?? ""] ?? null;
        const payment = paymentState(
          data.provider_accounts.filter((a) => a.surgeon_id === s.id),
          setting?.allowed_providers ?? [],
          s.country,
        );
        const readiness = computeSurgeonReadiness({
          surgeon: s,
          distributorId: data.assignments.find((a) => a.surgeon_id === s.id)?.distributor_id ?? null,
          countrySetting: setting,
          hasPolicy: data.policies.some(
            (p) => p.country === s.country && (p.surgeon_id === null || p.surgeon_id === s.id),
          ),
          payment,
          access: portalAccessState(data.memberships.filter((m) => m.surgeon_id === s.id)),
        });
        return {
          surgeon: s,
          // The surgeon's own currency wins; otherwise the country default.
          // A supported international country never falls back to USD.
          currency: (s.currency ?? setting?.default_currency ?? "USD").toUpperCase(),
          ready: readiness.tone === "ready",
          reason: readiness.label,
        };
      })
      .sort((a, b) => Number(b.ready) - Number(a.ready) || a.surgeon.name.localeCompare(b.surgeon.name));
  }, [data]);

  const selected = options.find((o) => o.surgeon.id === surgeonId) ?? null;
  const currency = selected?.currency ?? "";

  const pickSurgeon = (id: string) => {
    setSurgeonId(id);
    const o = options.find((x) => x.surgeon.id === id);
    if (o?.surgeon.consultation_fee_minor) {
      setAmount(String(fromMinor(o.surgeon.consultation_fee_minor, o.currency)));
    } else {
      setAmount("");
    }
  };

  const reset = () => {
    setSurgeonId("");
    setName("");
    setEmail("");
    setPhone("");
    setAmount("");
    setLink(null);
  };

  const submit = async () => {
    if (!surgeonId || !name.trim() || !amount) {
      toast({ title: "Surgeon, patient name and amount are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { data: result, error } = await supabase.functions.invoke("intl-create-consultation", {
      body: {
        surgeon_id: surgeonId,
        patient_name: name.trim(),
        patient_email: email.trim() || null,
        patient_phone: phone.trim() || null,
        amount_minor: toMinor(Number(amount), currency),
        currency,
      },
    });
    setSubmitting(false);

    const payload = result as { payment_url?: string; error?: string } | null;
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
            The fee is collected directly by the surgeon through their own connected payment account.
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
              <Label>Surgeon</Label>
              <Select value={surgeonId} onValueChange={pickSurgeon}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a surgeon" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.surgeon.id} value={o.surgeon.id} disabled={!o.ready}>
                      {o.surgeon.name} —{" "}
                      {(o.surgeon.country && COUNTRY_LABEL[o.surgeon.country]) ||
                        o.surgeon.country ||
                        "—"}
                      {o.ready ? "" : ` · ${o.reason}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Surgeons that are not ready are shown with the reason and cannot be selected.
              </p>
            </div>

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
                <Label>Amount {currency ? `(${currency})` : ""}</Label>
                <Input
                  type="number"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={!surgeonId}
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
            <Button onClick={submit} disabled={submitting || !selected?.ready}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create link"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
