import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign, Download, RefreshCw, CheckCircle2, Clock, XCircle, BadgeCheck,
  ChevronDown, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, ShieldCheck,
  Calendar
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { format, subDays, subMonths, startOfMonth, endOfMonth, startOfYear } from "date-fns";

// ── Types ──
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
  notes: string | null;
}

interface SurgeonSummary {
  surgeon_name: string;
  earned: number; issued: number; pending: number; forfeited: number; disputed: number;
  earnedCount: number; issuedCount: number; pendingCount: number; forfeitedCount: number; disputedCount: number;
  records: CreditRecord[];
}

type SortField = "patient_name" | "enrollment_date" | "surgery_date" | "stage" | "credit_amount" | "credit_status" | "issued_amount";
type SortDir = "asc" | "desc";
type DatePreset = "7d" | "30d" | "90d" | "this-month" | "last-month" | "ytd" | "all" | "custom";

interface DateRange { from?: Date; to?: Date; }

// ── Helpers ──
function formatDateUS(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatDateTimeUS(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function getDateRangeForPreset(preset: DatePreset): DateRange {
  const now = new Date();
  switch (preset) {
    case "7d": return { from: subDays(now, 7), to: now };
    case "30d": return { from: subDays(now, 30), to: now };
    case "90d": return { from: subDays(now, 90), to: now };
    case "this-month": return { from: startOfMonth(now), to: now };
    case "last-month": { const lm = subMonths(now, 1); return { from: startOfMonth(lm), to: endOfMonth(lm) }; }
    case "ytd": return { from: startOfYear(now), to: now };
    case "all": return {};
    default: return {};
  }
}

const STATUS_COLORS: Record<string, string> = {
  earned: "#10b981",
  issued: "#3b82f6",
  pending: "#f59e0b",
  forfeited: "#ef4444",
  disputed: "#f97316",
};

const presets: { value: DatePreset; label: string }[] = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "All Time" },
];

// ── Main Component ──
export function CreditsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [surgeonFilter, setSurgeonFilter] = useState<string>("all");
  const [expandedSurgeons, setExpandedSurgeons] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [sortField, setSortField] = useState<SortField>("patient_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [disputeDialogOpen, setDisputeDialogOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeTargetIds, setDisputeTargetIds] = useState<string[]>([]);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  // Date filter state
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [customOpen, setCustomOpen] = useState(false);

  const handlePreset = (p: DatePreset) => {
    setDatePreset(p);
    if (p !== "custom") setDateRange(getDateRangeForPreset(p));
  };

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

  // Apply date range, status, surgeon filters
  const filtered = useMemo(() => {
    let result = credits;

    // Date filter on enrollment_date
    if (dateRange.from) {
      const fromStr = format(dateRange.from, "yyyy-MM-dd");
      result = result.filter(c => !c.enrollment_date || c.enrollment_date >= fromStr);
    }
    if (dateRange.to) {
      const toStr = format(dateRange.to, "yyyy-MM-dd");
      result = result.filter(c => !c.enrollment_date || c.enrollment_date <= toStr);
    }

    if (statusFilter !== "all") result = result.filter(c => c.credit_status === statusFilter);
    if (surgeonFilter !== "all") result = result.filter(c => c.surgeon_name === surgeonFilter);
    return result;
  }, [credits, statusFilter, surgeonFilter, dateRange]);

  const sortRecords = (records: CreditRecord[]): CreditRecord[] => {
    return [...records].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "patient_name": cmp = a.patient_name.localeCompare(b.patient_name); break;
        case "enrollment_date": cmp = (a.enrollment_date || "").localeCompare(b.enrollment_date || ""); break;
        case "surgery_date": cmp = (a.surgery_date || "").localeCompare(b.surgery_date || ""); break;
        case "stage": cmp = (a.stage || "").localeCompare(b.stage || ""); break;
        case "credit_amount": cmp = a.credit_amount - b.credit_amount; break;
        case "credit_status": cmp = a.credit_status.localeCompare(b.credit_status); break;
        case "issued_amount": cmp = (a.issued_amount || 0) - (b.issued_amount || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(prev => prev === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const surgeonSummaries = useMemo(() => {
    const map = new Map<string, SurgeonSummary>();
    for (const c of filtered) {
      if (!map.has(c.surgeon_name)) {
        map.set(c.surgeon_name, {
          surgeon_name: c.surgeon_name,
          earned: 0, issued: 0, pending: 0, forfeited: 0, disputed: 0,
          earnedCount: 0, issuedCount: 0, pendingCount: 0, forfeitedCount: 0, disputedCount: 0,
          records: [],
        });
      }
      const s = map.get(c.surgeon_name)!;
      s.records.push(c);
      if (c.credit_status === "earned") { s.earned += c.credit_amount; s.earnedCount++; }
      else if (c.credit_status === "issued") { s.issued += c.issued_amount || c.credit_amount; s.issuedCount++; }
      else if (c.credit_status === "pending") { s.pending += c.credit_amount; s.pendingCount++; }
      else if (c.credit_status === "forfeited") { s.forfeited += c.credit_amount; s.forfeitedCount++; }
      else if (c.credit_status === "disputed") { s.disputed += c.credit_amount; s.disputedCount++; }
    }
    return Array.from(map.values()).sort((a, b) => a.surgeon_name.localeCompare(b.surgeon_name));
  }, [filtered]);

  const kpis = useMemo(() => {
    let earned = 0, issued = 0, pending = 0, forfeited = 0, disputed = 0;
    for (const c of filtered) {
      if (c.credit_status === "earned") earned += c.credit_amount;
      else if (c.credit_status === "issued") issued += c.issued_amount || c.credit_amount;
      else if (c.credit_status === "pending") pending += c.credit_amount;
      else if (c.credit_status === "forfeited") forfeited += c.credit_amount;
      else if (c.credit_status === "disputed") disputed += c.credit_amount;
    }
    return { earned, issued, pending, forfeited, disputed };
  }, [filtered]);

  // ── Chart data ──
  const surgeonBarData = useMemo(() => {
    return surgeonSummaries.map(s => ({
      name: s.surgeon_name.replace(/^Dr\.\s*/i, ""),
      Earned: s.earned,
      Issued: s.issued,
      Pending: s.pending,
      Disputed: s.disputed,
      Forfeited: s.forfeited,
    }));
  }, [surgeonSummaries]);

  const statusPieData = useMemo(() => {
    return [
      { name: "Earned", value: kpis.earned, fill: STATUS_COLORS.earned },
      { name: "Issued", value: kpis.issued, fill: STATUS_COLORS.issued },
      { name: "Pending", value: kpis.pending, fill: STATUS_COLORS.pending },
      { name: "Disputed", value: kpis.disputed, fill: STATUS_COLORS.disputed },
      { name: "Forfeited", value: kpis.forfeited, fill: STATUS_COLORS.forfeited },
    ].filter(d => d.value > 0);
  }, [kpis]);

  const surgeonNames = useMemo(() => {
    return [...new Set(credits.map(c => c.surgeon_name))].sort();
  }, [credits]);

  const selectableIds = useMemo(() => {
    return new Set(filtered.filter(c => c.credit_status === "earned").map(c => c.id));
  }, [filtered]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAllForSurgeon = (records: CreditRecord[]) => {
    const earnedIds = records.filter(c => c.credit_status === "earned").map(c => c.id);
    const allSelected = earnedIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      earnedIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const callEdgeFunction = async (body: Record<string, unknown>) => {
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
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  };

  const markIssuedMutation = useMutation({
    mutationFn: async (payments: { id: string; amount: number }[]) => callEdgeFunction({ payments }),
    onSuccess: (data) => {
      toast({ title: "Credits Issued", description: `${data.updated} credit(s) marked as issued` });
      setPaymentAmounts({});
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["surgeon-credits"] });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const disputeMutation = useMutation({
    mutationFn: async ({ credit_ids, reason }: { credit_ids: string[]; reason: string }) =>
      callEdgeFunction({ action: "dispute", credit_ids, reason }),
    onSuccess: (data) => {
      toast({ title: "Credits Disputed", description: `${data.updated} credit(s) flagged as disputed` });
      setDisputeDialogOpen(false); setDisputeReason(""); setDisputeTargetIds([]); setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["surgeon-credits"] });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: async (credit_ids: string[]) => callEdgeFunction({ action: "resolve", credit_ids }),
    onSuccess: (data) => {
      toast({ title: "Disputes Resolved", description: `${data.updated} credit(s) moved back to earned` });
      queryClient.invalidateQueries({ queryKey: ["surgeon-credits"] });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
    } finally { setSyncing(false); }
  };

  const handleMarkIssued = (creditId: string, creditAmount: number) => {
    const amountStr = paymentAmounts[creditId];
    const amount = amountStr ? parseFloat(amountStr) : creditAmount;
    if (isNaN(amount) || amount <= 0) { toast({ title: "Invalid amount", variant: "destructive" }); return; }
    markIssuedMutation.mutate([{ id: creditId, amount }]);
  };

  const handleBulkMarkIssued = () => {
    if (selectedIds.size === 0) { toast({ title: "No records selected", variant: "destructive" }); return; }
    const payments = Array.from(selectedIds).map(id => {
      const record = credits.find(c => c.id === id);
      const customAmount = paymentAmounts[id];
      const amount = customAmount ? parseFloat(customAmount) : (record?.credit_amount || 0);
      return { id, amount };
    }).filter(p => p.amount > 0);
    if (payments.length === 0) { toast({ title: "No valid amounts", variant: "destructive" }); return; }
    markIssuedMutation.mutate(payments);
  };

  const openDisputeDialog = (ids: string[]) => {
    setDisputeTargetIds(ids); setDisputeReason(""); setDisputeDialogOpen(true);
  };

  const handleConfirmDispute = () => {
    if (!disputeReason.trim()) { toast({ title: "Please provide a reason", variant: "destructive" }); return; }
    disputeMutation.mutate({ credit_ids: disputeTargetIds, reason: disputeReason });
  };

  const handleExportCSV = (surgeonName?: string) => {
    const data = surgeonName ? filtered.filter(c => c.surgeon_name === surgeonName) : filtered;
    const headers = ["Surgeon", "Patient", "Email", "Enrollment Date", "Surgery Date", "Stage", "$750 Expires", "$500 Expires", "Credit Amount", "Status", "Issued Amount", "Issued At", "Issued By", "Source"];
    const rows = data.map(c => [
      c.surgeon_name, c.patient_name, c.patient_email || "",
      formatDateUS(c.enrollment_date), formatDateUS(c.surgery_date), c.stage || "",
      formatDateUS(c.credit_750_expires), formatDateUS(c.credit_500_expires),
      c.credit_amount, c.credit_status, c.issued_amount || "",
      c.issued_at ? formatDateTimeUS(c.issued_at) : "", c.issued_by || "", c.source,
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
      case "disputed": return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"><AlertTriangle className="h-3 w-3 mr-1" />Disputed</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const dateLabel = dateRange.from && dateRange.to
    ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d, yyyy")}`
    : "All Time";

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
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

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 ml-2 px-3 py-1 bg-muted rounded-md">
            <span className="text-xs font-medium">{selectedIds.size} selected</span>
            <Button size="sm" variant="default" className="h-7 text-xs" disabled={markIssuedMutation.isPending} onClick={handleBulkMarkIssued}>
              <BadgeCheck className="h-3 w-3 mr-1" />Mark All as Paid
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50" onClick={() => openDisputeDialog(Array.from(selectedIds))}>
              <AlertTriangle className="h-3 w-3 mr-1" />Flag as Disputed
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="earned">Earned</SelectItem>
              <SelectItem value="issued">Issued</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="forfeited">Forfeited</SelectItem>
              <SelectItem value="disputed">Disputed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={surgeonFilter} onValueChange={setSurgeonFilter}>
            <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue placeholder="All Surgeons" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Surgeons</SelectItem>
              {surgeonNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Date Filter */}
      <div className="flex flex-wrap items-center gap-2">
        {presets.map(p => (
          <Button key={p.value} variant={datePreset === p.value ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => handlePreset(p.value)}>
            {p.label}
          </Button>
        ))}
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <Button variant={datePreset === "custom" ? "default" : "outline"} size="sm" className="h-8 text-xs gap-1" onClick={() => handlePreset("custom")}>
              <Calendar className="h-3.5 w-3.5" />Custom
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <CalendarPicker
              mode="range"
              selected={dateRange.from && dateRange.to ? { from: dateRange.from, to: dateRange.to } : undefined}
              onSelect={(range) => { if (range?.from) setDateRange({ from: range.from, to: range.to || range.from }); }}
              numberOfMonths={2}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">{dateLabel}</span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Earned (Unpaid)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-emerald-600">${kpis.earned.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Issued (Paid Out)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-blue-600">${kpis.issued.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-amber-600">${kpis.pending.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Disputed</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-orange-600">${kpis.disputed.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Forfeited</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-red-600">${kpis.forfeited.toLocaleString()}</div></CardContent></Card>
      </div>

      {/* Visual Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Surgeon credit bar chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Credits by Surgeon</CardTitle>
          </CardHeader>
          <CardContent>
            {surgeonBarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={surgeonBarData} layout="vertical" margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
                  <XAxis type="number" tickFormatter={(v) => `$${v}`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={100} fontSize={11} />
                  <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="Earned" stackId="a" fill={STATUS_COLORS.earned} />
                  <Bar dataKey="Pending" stackId="a" fill={STATUS_COLORS.pending} />
                  <Bar dataKey="Disputed" stackId="a" fill={STATUS_COLORS.disputed} />
                  <Bar dataKey="Issued" stackId="a" fill={STATUS_COLORS.issued} />
                  <Bar dataKey="Forfeited" stackId="a" fill={STATUS_COLORS.forfeited} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
            )}
          </CardContent>
        </Card>

        {/* Status distribution pie chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Credit Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {statusPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, value }) => `${name}: $${value.toLocaleString()}`}
                  >
                    {statusPieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-surgeon accordion */}
      <div className="space-y-2">
        {surgeonSummaries.map(surgeon => {
          const sorted = sortRecords(surgeon.records);
          const surgeonEarnedIds = surgeon.records.filter(c => c.credit_status === "earned").map(c => c.id);
          const allSurgeonSelected = surgeonEarnedIds.length > 0 && surgeonEarnedIds.every(id => selectedIds.has(id));

          return (
            <Collapsible key={surgeon.surgeon_name} open={expandedSurgeons.has(surgeon.surgeon_name)} onOpenChange={() => toggleExpand(surgeon.surgeon_name)}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {expandedSurgeons.has(surgeon.surgeon_name) ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <CardTitle className="text-base">{surgeon.surgeon_name}</CardTitle>
                        <span className="text-xs text-muted-foreground">({surgeon.records.length} patients)</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-emerald-600 font-medium">${surgeon.earned.toLocaleString()} earned</span>
                        <span className="text-blue-600 font-medium">${surgeon.issued.toLocaleString()} issued</span>
                        <span className="text-amber-600 font-medium">${surgeon.pending.toLocaleString()} pending</span>
                        {surgeon.disputed > 0 && <span className="text-orange-600 font-medium">${surgeon.disputed.toLocaleString()} disputed</span>}
                        <span className="text-red-600 font-medium">${surgeon.forfeited.toLocaleString()} forfeited</span>
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleExportCSV(surgeon.surgeon_name); }}>
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
                          <TableHead className="w-8">
                            {surgeonEarnedIds.length > 0 && (
                              <Checkbox checked={allSurgeonSelected} onCheckedChange={() => toggleSelectAllForSurgeon(surgeon.records)} />
                            )}
                          </TableHead>
                          <TableHead className="cursor-pointer select-none" onClick={() => handleSort("patient_name")}><div className="flex items-center">Patient<SortIcon field="patient_name" /></div></TableHead>
                          <TableHead className="cursor-pointer select-none" onClick={() => handleSort("enrollment_date")}><div className="flex items-center">Enrollment<SortIcon field="enrollment_date" /></div></TableHead>
                          <TableHead className="cursor-pointer select-none" onClick={() => handleSort("surgery_date")}><div className="flex items-center">Surgery<SortIcon field="surgery_date" /></div></TableHead>
                          <TableHead className="cursor-pointer select-none" onClick={() => handleSort("stage")}><div className="flex items-center">Stage<SortIcon field="stage" /></div></TableHead>
                          <TableHead className="cursor-pointer select-none" onClick={() => handleSort("credit_amount")}><div className="flex items-center">Credit Due<SortIcon field="credit_amount" /></div></TableHead>
                          <TableHead className="cursor-pointer select-none" onClick={() => handleSort("credit_status")}><div className="flex items-center">Status<SortIcon field="credit_status" /></div></TableHead>
                          <TableHead className="cursor-pointer select-none" onClick={() => handleSort("issued_amount")}><div className="flex items-center">Paid Amount<SortIcon field="issued_amount" /></div></TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sorted.map(c => (
                          <TableRow key={c.id} className={selectedIds.has(c.id) ? "bg-muted/30" : ""}>
                            <TableCell>
                              {c.credit_status === "earned" && <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} />}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{c.patient_name}</div>
                              {c.patient_email && <div className="text-xs text-muted-foreground">{c.patient_email}</div>}
                            </TableCell>
                            <TableCell className="text-sm">{formatDateUS(c.enrollment_date)}</TableCell>
                            <TableCell className="text-sm">{formatDateUS(c.surgery_date)}</TableCell>
                            <TableCell className="text-sm">{c.stage || "—"}</TableCell>
                            <TableCell className="font-medium">${c.credit_amount}</TableCell>
                            <TableCell>{statusBadge(c.credit_status)}</TableCell>
                            <TableCell>
                              {c.credit_status === "issued" ? (
                                <span className="font-medium text-blue-600">${c.issued_amount || c.credit_amount}</span>
                              ) : c.credit_status === "earned" ? (
                                <Input type="number" className="w-20 h-7 text-xs" placeholder={`${c.credit_amount}`} value={paymentAmounts[c.id] || ""} onChange={(e) => setPaymentAmounts(prev => ({ ...prev, [c.id]: e.target.value }))} />
                              ) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {c.credit_status === "earned" && (
                                  <>
                                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={markIssuedMutation.isPending} onClick={() => handleMarkIssued(c.id, c.credit_amount)}>
                                      <BadgeCheck className="h-3 w-3 mr-1" />Pay
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-7 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-50" onClick={() => openDisputeDialog([c.id])}>
                                      <AlertTriangle className="h-3 w-3" />
                                    </Button>
                                  </>
                                )}
                                {c.credit_status === "disputed" && (
                                  <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50" disabled={resolveMutation.isPending} onClick={() => resolveMutation.mutate([c.id])}>
                                    <ShieldCheck className="h-3 w-3 mr-1" />Resolve
                                  </Button>
                                )}
                                {c.credit_status === "issued" && c.issued_at && (
                                  <span className="text-xs text-muted-foreground">{formatDateTimeUS(c.issued_at)}</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
        {surgeonSummaries.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">No credit records found. Sync from CRM or import data to get started.</CardContent></Card>
        )}
      </div>

      {/* Dispute reason dialog */}
      <Dialog open={disputeDialogOpen} onOpenChange={setDisputeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flag Credit as Disputed</DialogTitle>
            <DialogDescription>Please describe the issue. This will be logged in the audit trail for tracking.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="e.g., Patient was charged full pricing. Working with clinic to confirm credit was extended before we can issue it." value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} rows={4} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDisputeDialogOpen(false)}>Cancel</Button>
            <Button variant="default" className="bg-orange-600 hover:bg-orange-700" disabled={disputeMutation.isPending || !disputeReason.trim()} onClick={handleConfirmDispute}>
              <AlertTriangle className="h-4 w-4 mr-2" />{disputeMutation.isPending ? "Flagging..." : `Flag ${disputeTargetIds.length} Credit(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
