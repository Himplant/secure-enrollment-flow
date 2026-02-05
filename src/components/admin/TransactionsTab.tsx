import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  MoreHorizontal, 
  Eye, 
  Copy, 
  RefreshCw,
  Loader2,
  Calendar,
  CreditCard,
  Building2,
  Clock,
  Trash2,
  ArrowUpDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/StatusBadge";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RegenerateLinkModal } from "./RegenerateLinkModal";
import { TransactionDetailsModal } from "./TransactionDetailsModal";

type EnrollmentStatus = 'created' | 'sent' | 'opened' | 'processing' | 'paid' | 'failed' | 'expired' | 'canceled';

interface Transaction {
  id: string;
  token_last4: string;
  patient_name: string | null;
  patient_email: string | null;
  patient_id: string | null;
  amount_cents: number;
  status: EnrollmentStatus;
  payment_method_type: string | null;
  created_at: string | null;
  opened_at: string | null;
  terms_accepted_at: string | null;
  processing_at: string | null;
  paid_at: string | null;
  failed_at: string | null;
  expired_at: string | null;
  expires_at: string;
  terms_accept_ip: string | null;
  policy_id: string | null;
  surgeon_name?: string | null;
}

interface Surgeon {
  id: string;
  name: string;
}

export function TransactionsTab() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [surgeonFilter, setSurgeonFilter] = useState<string>("all");
  const [sortByExpiration, setSortByExpiration] = useState<"asc" | "desc" | null>(null);
  const [regenerateEnrollment, setRegenerateEnrollment] = useState<Transaction | null>(null);
  const [detailsEnrollmentId, setDetailsEnrollmentId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch surgeons for filter dropdown
  const { data: surgeons = [] } = useQuery({
    queryKey: ["surgeons-filter"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surgeons")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Surgeon[];
    },
  });

  const { data: transactions, isLoading, refetch } = useQuery({
    queryKey: ["transactions", statusFilter, surgeonFilter],
    queryFn: async () => {
      // Fetch enrollments with patient and surgeon info
      let query = supabase
        .from("enrollments")
        .select(`
          id, token_last4, patient_name, patient_email, patient_id, 
          amount_cents, status, payment_method_type, 
          created_at, opened_at, terms_accepted_at, processing_at, 
          paid_at, failed_at, expired_at, expires_at, 
          terms_accept_ip, policy_id,
          patients!enrollments_patient_id_fkey (
            surgeon_id,
            surgeon:surgeons(id, name)
          )
        `)
        .order("created_at", { ascending: false })
        .limit(200);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as EnrollmentStatus);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Process data to flatten surgeon info and apply surgeon filter
      const processed = (data || []).map((enrollment: any) => ({
        ...enrollment,
        surgeon_name: enrollment.patients?.surgeon?.name || null,
        surgeon_id: enrollment.patients?.surgeon_id || null,
      }));

      // Apply surgeon filter client-side (since it's nested)
      if (surgeonFilter !== "all") {
        return processed.filter((t: any) => 
          surgeonFilter === "unassigned" ? !t.surgeon_id : t.surgeon_id === surgeonFilter
        ) as Transaction[];
      }

      return processed as Transaction[];
    },
  });

  // Delete transaction mutation
  const deleteTransactionMutation = useMutation({
    mutationFn: async (transactionId: string) => {
      const { error } = await supabase
        .from("enrollments")
        .delete()
        .eq("id", transactionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["enrollment-stats"] });
      toast({ title: "Transaction deleted", description: "Enrollment has been removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    
    let result = transactions;
    
    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.patient_name?.toLowerCase().includes(searchLower) ||
          t.patient_email?.toLowerCase().includes(searchLower) ||
          t.token_last4.includes(search)
      );
    }
    
    // Apply expiration sorting
    if (sortByExpiration) {
      result = [...result].sort((a, b) => {
        const aTime = new Date(a.expires_at).getTime();
        const bTime = new Date(b.expires_at).getTime();
        return sortByExpiration === "asc" ? aTime - bTime : bTime - aTime;
      });
    }
    
    return result;
  }, [transactions, search, sortByExpiration]);

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const handleCopyToken = (tokenLast4: string) => {
    navigator.clipboard.writeText(`****${tokenLast4}`);
    toast({
      title: "Token copied",
      description: "Token reference copied. For a full link, use 'Regenerate Link'.",
    });
  };

  const handleViewDetails = (transaction: Transaction) => {
    setDetailsEnrollmentId(transaction.id);
  };

  // Format timestamps for tooltip
  const getTimestampTooltip = (transaction: Transaction) => {
    const lines: string[] = [];
    if (transaction.created_at) lines.push(`Created: ${format(new Date(transaction.created_at), "MMM d, h:mm a")}`);
    if (transaction.opened_at) lines.push(`Opened: ${format(new Date(transaction.opened_at), "MMM d, h:mm a")}`);
    if (transaction.terms_accepted_at) lines.push(`Terms: ${format(new Date(transaction.terms_accepted_at), "MMM d, h:mm a")}`);
    if (transaction.paid_at) lines.push(`Paid: ${format(new Date(transaction.paid_at), "MMM d, h:mm a")}`);
    return lines.join("\n");
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search by patient name, email, or token..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="opened">Opened</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={surgeonFilter} onValueChange={setSurgeonFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All surgeons" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Surgeons</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {surgeons.map((surgeon) => (
              <SelectItem key={surgeon.id} value={surgeon.id}>
                {surgeon.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Transactions Table */}
      <Card className="card-premium overflow-hidden">
        <CardHeader className="border-b border-border bg-muted/30">
          <CardTitle className="text-lg">
            Transactions
            {filteredTransactions.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({filteredTransactions.length} results)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No transactions found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Patient</TableHead>
                  <TableHead>Surgeon</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 font-medium hover:bg-transparent"
                      onClick={() => setSortByExpiration(prev => 
                        prev === null ? "asc" : prev === "asc" ? "desc" : null
                      )}
                    >
                      Expires
                      <ArrowUpDown className={`ml-1 h-3 w-3 ${sortByExpiration ? "text-primary" : "text-muted-foreground"}`} />
                    </Button>
                  </TableHead>
                  <TableHead>Key Dates</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTransactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">
                          {transaction.patient_name || "Unknown"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {transaction.patient_email || "No email"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {transaction.surgeon_name ? (
                        <span className="text-sm text-foreground">{transaction.surgeon_name}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatAmount(transaction.amount_cents)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={transaction.status} />
                    </TableCell>
                    <TableCell>
                      {transaction.payment_method_type ? (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          {transaction.payment_method_type === "card" ? (
                            <>
                              <CreditCard className="h-4 w-4" />
                              Card
                            </>
                          ) : (
                            <>
                              <Building2 className="h-4 w-4" />
                              ACH
                            </>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1.5 text-muted-foreground cursor-help">
                              <Calendar className="h-4 w-4" />
                              {transaction.created_at
                                ? format(new Date(transaction.created_at), "MMM d, yyyy")
                                : "—"}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="whitespace-pre-line text-xs">
                            {getTimestampTooltip(transaction)}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(transaction.expires_at), "MMM d, h:mm a")}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <div className="space-y-0.5">
                          {transaction.terms_accepted_at && (
                            <p className="text-success">Terms ✓</p>
                          )}
                          {transaction.paid_at && (
                            <p className="text-success">
                              Paid {format(new Date(transaction.paid_at), "MMM d")}
                            </p>
                          )}
                          {!transaction.terms_accepted_at && !transaction.paid_at && (
                            <p>Pending</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm text-muted-foreground">
                        ****{transaction.token_last4}
                      </span>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleViewDetails(transaction)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCopyToken(transaction.token_last4)}>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy Token
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setRegenerateEnrollment(transaction)}
                            disabled={["paid", "processing"].includes(transaction.status)}
                          >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Get New Link
                          </DropdownMenuItem>
                          {!["paid", "processing"].includes(transaction.status) && (
                            <DropdownMenuItem 
                              onClick={() => {
                                if (confirm(`Delete this enrollment for ${transaction.patient_name || 'Unknown'}? This cannot be undone.`)) {
                                  deleteTransactionMutation.mutate(transaction.id);
                                }
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      {/* Regenerate Modal */}
      {regenerateEnrollment && (
        <RegenerateLinkModal
          isOpen={!!regenerateEnrollment}
          onClose={() => setRegenerateEnrollment(null)}
          enrollment={regenerateEnrollment}
        />
      )}

      {/* Details Modal */}
      {detailsEnrollmentId && (
        <TransactionDetailsModal
          isOpen={!!detailsEnrollmentId}
          onClose={() => setDetailsEnrollmentId(null)}
          enrollmentId={detailsEnrollmentId}
        />
      )}
    </div>
  );
}
