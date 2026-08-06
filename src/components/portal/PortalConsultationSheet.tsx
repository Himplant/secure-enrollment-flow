import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { IntlStatusBadge } from "@/components/intl/IntlStatusBadge";
import { formatIntlMoney, COUNTRY_LABEL } from "@/lib/intlMoney";
import { invokePortal, usePortalConsultation } from "@/hooks/usePortalConsultations";
import type { IntlSurgeryStatus } from "@/lib/intlStatus";

const fmt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

interface Props {
  consultationId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function PortalConsultationSheet({ consultationId, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading } = usePortalConsultation(consultationId);
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);

  const c = data?.consultation;

  useEffect(() => {
    setNewLink(null);
    setScheduledAt(c?.scheduled_at ? new Date(c.scheduled_at).toISOString().slice(0, 16) : "");
    setNotes(c?.outcome_notes ?? "");
  }, [c?.id, c?.scheduled_at, c?.outcome_notes]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["portal-consultation", consultationId] });
    queryClient.invalidateQueries({ queryKey: ["portal-consultations"] });
  };

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!consultationId) return;
    setBusy(action);
    try {
      await invokePortal("intl-portal-update-consultation", {
        consultation_id: consultationId,
        action,
        ...extra,
      });
      toast.success("Consultation updated");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const reissueLink = async () => {
    if (!consultationId) return;
    setBusy("link");
    try {
      const res = await invokePortal<{ payment_url: string; expires_at: string }>(
        "intl-portal-resend-link",
        { consultation_id: consultationId },
      );
      setNewLink(res.payment_url);
      toast.success("New payment link generated");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reissue the link");
    } finally {
      setBusy(null);
    }
  };

  const paid = c?.payment_status === "approved";

  return (
    <Sheet open={!!consultationId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {isLoading || !c ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6">
            <SheetHeader>
              <SheetTitle>{data?.patient?.full_name ?? "Consultation"}</SheetTitle>
              <SheetDescription>
                {data?.surgeon?.name} · {COUNTRY_LABEL[c.country] ?? c.country} ·{" "}
                {formatIntlMoney(c.amount_minor, c.currency)}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap gap-2">
              <IntlStatusBadge kind="payment" status={c.payment_status} />
              <IntlStatusBadge kind="consultation" status={c.consultation_status} />
              <IntlStatusBadge kind="surgery" status={c.surgery_status} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Email" value={data?.patient?.email ?? "—"} />
              <Field label="Phone" value={data?.patient?.phone ?? "—"} />
              <Field label="Surgeon" value={data?.surgeon?.name ?? "—"} />
              <Field label="Language" value={data?.patient?.preferred_language ?? "—"} />
              <Field label="Paid at" value={fmt(c.paid_at)} />
              <Field label="Link expires" value={fmt(c.expires_at)} />
              <Field label="First contact" value={fmt(c.first_contact_at)} />
              <Field label="Scheduled" value={fmt(c.scheduled_at)} />
            </div>

            {readOnly && (
              <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                Read-only view. Only the surgeon's own team can update a consultation.
              </p>
            )}

            {!readOnly && (
            <>
            <Separator />

            {/* Link management */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Payment link</h3>

              <p className="text-xs text-muted-foreground">
                Link ending ••••{c.token_last4}. Reissuing invalidates the previous link and
                resets the expiry.
              </p>
              <Button variant="outline" size="sm" onClick={reissueLink} disabled={paid || busy === "link"}>
                {busy === "link" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="mr-2 h-4 w-4" />
                )}
                {paid ? "Paid — no link needed" : "Generate new link"}
              </Button>
              {newLink && (
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                  <code className="flex-1 truncate text-xs">{newLink}</code>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(newLink);
                      toast.success("Link copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </section>

            <Separator />

            {/* Lifecycle */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Consultation progress</h3>
              {!paid && (
                <p className="text-xs text-muted-foreground">
                  Progress actions unlock once the consultation fee is paid.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!paid || !!busy} onClick={() => run("mark_contacted")}>
                  Mark contacted
                </Button>
                <Button size="sm" variant="outline" disabled={!paid || !!busy} onClick={() => run("mark_completed")}>
                  Mark completed
                </Button>
                <Button size="sm" variant="outline" disabled={!paid || !!busy} onClick={() => run("mark_no_show")}>
                  No show
                </Button>
                <Button size="sm" variant="outline" disabled={!paid || !!busy} onClick={() => run("mark_canceled")}>
                  Cancel
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="scheduled-at">Appointment date &amp; time</Label>
                <div className="flex gap-2">
                  <Input
                    id="scheduled-at"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                  <Button
                    size="sm"
                    disabled={!paid || !scheduledAt || !!busy}
                    onClick={() =>
                      run(c.scheduled_at ? "reschedule" : "schedule", {
                        scheduled_at: new Date(scheduledAt).toISOString(),
                      })
                    }
                  >
                    {c.scheduled_at ? "Reschedule" : "Schedule"}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Surgery status</Label>
                <Select
                  value={c.surgery_status}
                  onValueChange={(v) => run("set_surgery_status", { surgery_status: v as IntlSurgeryStatus })}
                  disabled={!paid || !!busy}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    <SelectItem value="recommended">Recommended</SelectItem>
                    <SelectItem value="scheduled">Surgery scheduled</SelectItem>
                    <SelectItem value="completed">Surgery completed</SelectItem>
                    <SelectItem value="declined">Declined</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="outcome-notes">Notes</Label>
                <Textarea
                  id="outcome-notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Outcome, follow-up, patient preferences…"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!!busy}
                  onClick={() => run("add_note", { outcome_notes: notes })}
                >
                  Save notes
                </Button>
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Activity</h3>
              <ul className="space-y-2">
                {(data?.events ?? []).map((e, i) => (
                  <li key={i} className="flex justify-between gap-3 text-xs">
                    <span className="font-medium">{e.event_type.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground">{fmt(e.created_at)}</span>
                  </li>
                ))}
                {(data?.events ?? []).length === 0 && (
                  <li className="text-xs text-muted-foreground">No activity yet.</li>
                )}
              </ul>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate">{value}</p>
    </div>
  );
}
