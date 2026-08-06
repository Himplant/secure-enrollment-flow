/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Mail, RefreshCw, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatIntlMoney, COUNTRY_LABEL } from "@/lib/intlMoney";
import { IntlStatusBadge } from "@/components/intl/IntlStatusBadge";
import type { IntlConsultationStatus, IntlPaymentStatus } from "@/lib/intlStatus";

interface Props {
  consultationId: string | null;
  onOpenChange: (open: boolean) => void;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

export function ConsultationDetailDrawer({ consultationId, onOpenChange }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["intl-consultation-detail", consultationId],
    enabled: !!consultationId,
    queryFn: async () => {
      const id = consultationId as string;
      const [c, messages, attempts, snapshot, events, tasks, outbox] = await Promise.all([
        supabase
          .from("consultations")
          .select(
            "*, surgeon:surgeons(name, country, city), patient:consultation_patients(full_name, email, phone, preferred_language), distributor:distributors(name)",
          )
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("consultation_messages")
          .select("*")
          .eq("consultation_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("consultation_payment_attempts")
          .select("*")
          .eq("consultation_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("consultation_policy_snapshots")
          .select("*")
          .eq("consultation_id", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("consultation_events")
          .select("*")
          .eq("consultation_id", id)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase.from("consultation_tasks").select("*").eq("consultation_id", id),
        supabase
          .from("intl_zoho_outbox")
          .select("id, operation, status, attempts, last_error, next_attempt_at")
          .eq("consultation_id", id)
          .order("created_at", { ascending: false }),
      ]);
      return {
        c: c.data as Record<string, any>,
        messages: messages.data ?? [],
        attempts: attempts.data ?? [],
        snapshot: snapshot.data as Record<string, any> | null,
        events: events.data ?? [],
        tasks: tasks.data ?? [],
        outbox: outbox.data ?? [],
      };
    },
  });

  const runAction = async (action: "send_reminder" | "regenerate") => {
    if (!consultationId) return;
    if (action === "regenerate") {
      const okConfirm = window.confirm(
        "Regenerating creates a NEW payment link and immediately invalidates the current one. Continue?",
      );
      if (!okConfirm) return;
    }
    setBusy(action);
    const { data: res, error } = await supabase.functions.invoke("intl-send-consultation-link", {
      body: { consultation_id: consultationId, action, confirm_invalidate: action === "regenerate" },
    });
    setBusy(null);
    if (error || (res as { error?: string })?.error) {
      toast({
        title: action === "regenerate" ? "Could not regenerate link" : "Could not send reminder",
        description: (res as { error?: string })?.error ?? error?.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: action === "regenerate" ? "New link generated and sent" : "Reminder sent" });
    qc.invalidateQueries({ queryKey: ["intl-consultation-detail", consultationId] });
    qc.invalidateQueries({ queryKey: ["intl-consultations"] });
  };

  const c = data?.c;

  return (
    <Sheet open={!!consultationId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Consultation detail</SheetTitle>
        </SheetHeader>

        {isLoading || !c ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap gap-2">
              <IntlStatusBadge kind="payment" status={c.payment_status as IntlPaymentStatus} />
              <IntlStatusBadge kind="consultation" status={c.consultation_status as IntlConsultationStatus} />
              <Badge variant="outline">{COUNTRY_LABEL[c.country] ?? c.country}</Badge>
              <Badge variant="outline">{String(c.provider).replace(/_/g, " ")}</Badge>
            </div>

            <div className="flex gap-2">
              <Button size="sm" className="gap-2" disabled={busy !== null} onClick={() => runAction("send_reminder")}>
                {busy === "send_reminder" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send reminder
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={busy !== null}
                onClick={() => runAction("regenerate")}
              >
                {busy === "regenerate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Regenerate link
              </Button>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Reminders reuse the current link. Regenerating invalidates it.
            </p>

            <Separator />

            <Section title="Patient">
              <Row label="Name" value={c.patient?.full_name ?? "—"} />
              <Row label="Email" value={c.patient?.email ?? "—"} />
              <Row label="Phone" value={c.patient?.phone ?? "—"} />
              <Row label="Language" value={(c.patient?.preferred_language ?? "—").toUpperCase()} />
            </Section>

            <Section title="Surgeon & fee">
              <Row label="Surgeon" value={c.surgeon?.name ?? "—"} />
              <Row label="Distributor" value={c.distributor?.name ?? "Direct"} />
              <Row label="Fee" value={formatIntlMoney(c.amount_minor, c.currency)} />
              <Row label="Agent" value={c.agent_email ?? "—"} />
            </Section>

            <Section title="Payment link">
              <Row label="Link ending" value={c.token_last4} />
              <Row label="Expires" value={new Date(c.expires_at).toLocaleString()} />
              <Row label="Sent" value={c.sent_at ? new Date(c.sent_at).toLocaleString() : "Not sent"} />
              <Row label="Opened" value={c.opened_at ? new Date(c.opened_at).toLocaleString() : "Not opened"} />
              <Row label="Paid" value={c.paid_at ? new Date(c.paid_at).toLocaleString() : "—"} />
            </Section>

            <Section title="Policy snapshot">
              {data?.snapshot ? (
                <>
                  <Row label="Version" value={data.snapshot.policy_version} />
                  <Row label="Language" value={String(data.snapshot.language).toUpperCase()} />
                  <Row
                    label="SHA-256"
                    value={<span className="font-mono text-xs">{String(data.snapshot.content_sha256).slice(0, 16)}…</span>}
                  />
                  <Row
                    label="Accepted"
                    value={c.terms_accepted_at ? new Date(c.terms_accepted_at).toLocaleString() : "Not yet"}
                  />
                </>
              ) : (
                <p className="text-sm text-destructive">No policy snapshot — checkout is blocked.</p>
              )}
            </Section>

            <Section title={`Messages (${data?.messages.length ?? 0})`}>
              {data?.messages.length === 0 && <p className="text-sm text-muted-foreground">No emails sent yet.</p>}
              {data?.messages.map((m) => (
                <div key={m.id as string} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{String(m.message_type).replace(/_/g, " ")}</span>
                    <Badge variant={m.status === "failed" || m.status === "bounced" ? "destructive" : "secondary"}>
                      {String(m.status)}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground">
                    {String(m.recipient)} · {new Date(m.created_at as string).toLocaleString()}
                  </div>
                  {m.error ? <div className="text-destructive">{String(m.error)}</div> : null}
                </div>
              ))}
            </Section>

            <Section title={`Payment attempts (${data?.attempts.length ?? 0})`}>
              {data?.attempts.length === 0 && <p className="text-sm text-muted-foreground">No attempts yet.</p>}
              {data?.attempts.map((a) => (
                <div key={a.id as string} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{String(a.provider).replace(/_/g, " ")}</span>
                    <Badge variant={a.status === "failed" ? "destructive" : "secondary"}>{String(a.status)}</Badge>
                  </div>
                  <div className="font-mono text-muted-foreground">{String(a.provider_order_id ?? "—")}</div>
                  <div className="text-muted-foreground">{new Date(a.created_at as string).toLocaleString()}</div>
                </div>
              ))}
            </Section>

            <Section title="SLA tasks">
              {data?.tasks.length === 0 && <p className="text-sm text-muted-foreground">No tasks.</p>}
              {data?.tasks.map((t) => (
                <Row
                  key={t.id as string}
                  label={String(t.task_type).replace(/_/g, " ")}
                  value={
                    t.completed_at
                      ? `Done ${new Date(t.completed_at as string).toLocaleDateString()}`
                      : t.due_at
                        ? `Due ${new Date(t.due_at as string).toLocaleString()}`
                        : "Open"
                  }
                />
              ))}
            </Section>

            <Section title="Zoho sync">
              <Row label="Record" value={c.zoho_record_id ?? "—"} />
              {data?.outbox.length === 0 && <p className="text-sm text-muted-foreground">Nothing queued.</p>}
              {data?.outbox.map((o) => (
                <Row
                  key={o.id as string}
                  label={String(o.operation)}
                  value={
                    <Badge variant={o.status === "failed" || o.status === "dead" ? "destructive" : "secondary"}>
                      {String(o.status)} · {String(o.attempts)}
                    </Badge>
                  }
                />
              ))}
            </Section>

            <Section title="Activity timeline">
              <div className="space-y-1">
                {data?.events.map((e) => (
                  <div key={e.id as string} className="text-xs">
                    <span className="font-medium">{String(e.event_type).replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {new Date(e.created_at as string).toLocaleString()}
                      {e.actor_email ? ` · ${e.actor_email}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
