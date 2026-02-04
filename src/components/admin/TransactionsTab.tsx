import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  MoreHorizontal, 
  Eye, 
  Copy, 
  RefreshCw,
  Loader2,
  Calendar,
  CreditCard,
  Building2
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
import { StatusBadge } from "@/components/StatusBadge";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RegenerateLinkModal } from "./RegenerateLinkModal";

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
  paid_at: string | null;
  expires_at: string;
}

export function TransactionsTab() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [regenerateEnrollment, setRegenerateEnrollment] = useState<Transaction | null>(null);
  const { toast } = useToast();

  const { data: transactions, isLoading, refetch } = useQuery({
    queryKey: ["transactions", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("enrollments")
        .select("id, token_last4, patient_name, patient_email, patient_id, amount_cents, status, payment_method_type, created_at, paid_at, expires_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as EnrollmentStatus);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Transaction[];
    },
  });

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    if (!search) return transactions;

    const searchLower = search.toLowerCase();
    return transactions.filter(
      (t) =>
        t.patient_name?.toLowerCase().includes(searchLower) ||
        t.patient_email?.toLowerCase().includes(searchLower) ||
        t.token_last4.includes(search)
    );
  }, [transactions, search]);

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const handleCopyLink = (tokenLast4: string) => {
    const baseUrl = window.location.origin;
    navigator.clipboard.writeText(`${baseUrl}/enroll/****${tokenLast4}`);
    toast({
      title: "Link copied",
      description: "Enrollment link copied to clipboard (partial token shown)",
    });
  };

  const handleViewDetails = (transaction: Transaction) => {
    toast({
      title: "Transaction Details",
      description: `ID: ${transaction.id.slice(0, 8)}... | Status: ${transaction.status}`,
    });
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
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment Method</TableHead>
                  <TableHead>Date</TableHead>
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
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        {transaction.created_at
                          ? format(new Date(transaction.created_at), "MMM d, yyyy")
                          : "—"}
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
                          <DropdownMenuItem onClick={() => handleCopyLink(transaction.token_last4)}>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy Link
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setRegenerateEnrollment(transaction)}
                            disabled={!["expired", "canceled", "failed"].includes(transaction.status)}
                          >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Regenerate Link
                          </DropdownMenuItem>
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
    </div>
  );
}
