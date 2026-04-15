import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign, Download, RefreshCw, CheckCircle2, Clock, XCircle, BadgeCheck,
  ChevronDown, ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface CreditRecord {
  id: string;
  surgeon_name: string;
  surgeon_id: string | null;
  patient_name: string;
  patient_email: string | null;
  consultant_email: string | null;
  enrollment_date: string | null;
  surgery_date: string | null;
  stage: string | null;
  credit_750_expires: string | null;
  credit_500_expires: string | null;
  credit_amount: number;
  credit_status: string;
  issued_amount: number;
  issued_at: string | null;
  issued_by: string | null;
  source: string;
  created_at: string;
}

interface SurgeonSummary {
  surgeon_name: string;
  earned: number;
  issued: number;
  pending: number;
  forfeited: number;
  earnedCount: number;
  issuedCount: number;
  pendingCount: number;
  forfeitedCount: number;
  records: CreditRecord[];
}

export function CreditsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [surgeonFilter, setSurgeonFilter] = useState<string>("all");
  const [expandedSurgeons, setExpandedSurgeons] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});

  const { data: credits = [], isLoading } = useQuery({
    queryKey: ["surgeon-credits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surgeon_credits")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CreditRecord[];
    },
  });

  const filtered = useMemo(() => {
    let result = credits;
    if (statusFilter !== "all") result = result.filter(c => c.credit_status === statusFilter);
    if (surgeonFilter !== "all") result = result.filter(c => c.surgeon_name === surgeonFilter);
    return result;
  }, [credits, statusFilter, surgeonFilter]);

  const surgeonSummaries = useMemo(() => {
    const map = new Map<string, SurgeonSummary>();
    for (const c of filtered) {
      if (!map.has(c.surgeon_name)) {
        map.set(c.surgeon_name, {
          surgeon_name: c.surgeon_name,
          earned: 0, issued: 0, pending: 0, forfeited: 0,
          earnedCount: 0, issuedCount: 0, pendingCount: 0, forfeitedCount: 0,
          records: [],
        });
      }
      const s = map.get(c.surgeon_name)!;
      s.records.push(c);
      if (c.credit_status === "earned") { s.earned += c.credit_amount; s.earnedCount++; }
      else if (c.credit_status === "issued") { s.issued += c.issued_amount || c.credit_amount; s.issuedCount++; }
      else if (c.credit_status === "pending") { s.pending += c.credit_amount; s.pendingCount++; }
      else if (c.credit_status === "forfeited") { s.forfeited += c.credit_amount; s.forfeitedCount++; }
    }
    return Array.from(map.values()).sort((a, b) => a.surgeon_name.localeCompare(b.surgeon_name));
  }, [filtered]);

  const kpis = useMemo(() => {
    let earned = 0, issued = 0, pending = 0, forfeited = 0;
    for (const c of filtered) {
      if (c.credit_status === "earned") earned += c.credit_amount;
      else if (c.credit_status === "issued") issued += c.issued_amount || c.credit_amount;
      else if (c.credit_status === "pending") pending += c.credit_amount;
      else if (c.credit_status === "forfeited") forfeited += c.credit_amount;
    }
    return { earned, issued, pending, forfeited };
  }, [filtered]);

  const surgeonNames = useMemo(() => {
    return [...new Set(credits.map(c => c.surgeon_name))].sort();
  }, [credits]);

  const markIssuedMutation = useMutation({
    mutationFn: async (payments: { id: string; amount: number }[]) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mark-credit-issued`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ payments }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Credits Issued", description: `${data.updated} credit(s) marked as issued` });
      setPaymentAmounts({});
      queryClient.invalidateQueries({ queryKey: ["surgeon-credits"] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-credits`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast({ title: "Sync Complete", description: `${data.upserted} credits synced from CRM` });
      queryClient.invalidateQueries({ queryKey: ["surgeon-credits"] });
    } catch (err: any) {
      toast({ title: "Sync Failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const handleMarkIssued = (creditId: string, creditAmount: number) => {
    const amountStr = paymentAmounts[creditId];
    const amount = amountStr ? parseFloat(amountStr) : creditAmount;
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    markIssuedMutation.mutate([{ id: creditId, amount }]);
  };

  const handleExportCSV = (surgeonName?: string) => {
    const data = surgeonName
      ? filtered.filter(c => c.surgeon_name === surgeonName)
      : filtered;

    const headers = ["Surgeon", "Patient", "Email", "Enrollment Date", "Surgery Date", "Stage", "$750 Expires", "$500 Expires", "Credit Amount", "Status", "Issued Amount", "Issued At", "Issued By", "Source"];
    const rows = data.map(c => [
      c.surgeon_name, c.patient_name, c.patient_email || "",
      c.enrollment_date || "", c.surgery_date || "", c.stage || "",
      c.credit_750_expires || "", c.credit_500_expires || "",
      c.credit_amount, c.credit_status, c.issued_amount || "",
      c.issued_at || "", c.issued_by || "", c.source,
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `credit-report${surgeonName ? `-${surgeonName.replace(/[^a-zA-Z]/g, "_")}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleExpand = (name: string) => {
    setExpandedSurgeons(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "earned": return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3 mr-1" />Earned</Badge>;
      case "issued": return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"><BadgeCheck className="h-3 w-3 mr-1" />Issued</Badge>;
      case "pending": return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case "forfeited": return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"><XCircle className="h-3 w-3 mr-1" />Forfeited</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSync} disabled={syncing} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync from CRM"}
        </Button>
        <Button onClick={() => handleExportCSV()} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />Export All CSV
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="earned">Earned</SelectItem>
              <SelectItem value="issued">Issued</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="forfeited">Forfeited</SelectItem>
            </SelectContent>
          </Select>
          <Select value={surgeonFilter} onValueChange={setSurgeonFilter}>
            <SelectTrigger className="w-[200px] h-8 text-xs">
              <SelectValue placeholder="All Surgeons" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Surgeons</SelectItem>
              {surgeonNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Earned (Unpaid)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">${kpis.earned.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Issued (Paid Out)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">${kpis.issued.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">${kpis.pending.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Forfeited</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">${kpis.forfeited.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Per-surgeon accordion */}
      <div className="space-y-2">
        {surgeonSummaries.map(surgeon => (
          <Collapsible
            key={surgeon.surgeon_name}
            open={expandedSurgeons.has(surgeon.surgeon_name)}
            onOpenChange={() => toggleExpand(surgeon.surgeon_name)}
          >
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {expandedSurgeons.has(surgeon.surgeon_name)
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <CardTitle className="text-base">{surgeon.surgeon_name}</CardTitle>
                      <span className="text-xs text-muted-foreground">({surgeon.records.length} patients)</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-emerald-600 font-medium">${surgeon.earned.toLocaleString()} earned</span>
                      <span className="text-blue-600 font-medium">${surgeon.issued.toLocaleString()} issued</span>
                      <span className="text-amber-600 font-medium">${surgeon.pending.toLocaleString()} pending</span>
                      <span className="text-red-600 font-medium">${surgeon.forfeited.toLocaleString()} forfeited</span>
                      <Button
                        variant="ghost" size="sm"
                        onClick={(e) => { e.stopPropagation(); handleExportCSV(surgeon.surgeon_name); }}
                      >
                        <Download className="h-3 w-3 mr-1" />CSV
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Patient</TableHead>
                        <TableHead>Enrollment</TableHead>
                        <TableHead>Surgery</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead>Credit Due</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Paid Amount</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {surgeon.records.map(c => (
                        <TableRow key={c.id}>
                          <TableCell>
                            <div className="font-medium">{c.patient_name}</div>
                            {c.patient_email && <div className="text-xs text-muted-foreground">{c.patient_email}</div>}
                          </TableCell>
                          <TableCell className="text-sm">{c.enrollment_date || "—"}</TableCell>
                          <TableCell className="text-sm">{c.surgery_date || "—"}</TableCell>
                          <TableCell className="text-sm">{c.stage || "—"}</TableCell>
                          <TableCell className="font-medium">${c.credit_amount}</TableCell>
                          <TableCell>{statusBadge(c.credit_status)}</TableCell>
                          <TableCell>
                            {c.credit_status === "issued" ? (
                              <span className="font-medium text-blue-600">${c.issued_amount || c.credit_amount}</span>
                            ) : c.credit_status === "earned" ? (
                              <Input
                                type="number"
                                className="w-20 h-7 text-xs"
                                placeholder={`${c.credit_amount}`}
                                value={paymentAmounts[c.id] || ""}
                                onChange={(e) => setPaymentAmounts(prev => ({ ...prev, [c.id]: e.target.value }))}
                              />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {c.credit_status === "earned" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={markIssuedMutation.isPending}
                                onClick={() => handleMarkIssued(c.id, c.credit_amount)}
                              >
                                <BadgeCheck className="h-3 w-3 mr-1" />
                                Pay
                              </Button>
                            )}
                            {c.credit_status === "issued" && c.issued_at && (
                              <span className="text-xs text-muted-foreground">
                                {new Date(c.issued_at).toLocaleDateString()}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        ))}
        {surgeonSummaries.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No credit records found. Sync from CRM or import data to get started.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
