import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Edit, Plus, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AuditEntry {
  id: string;
  admin_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_summary: Record<string, unknown> | null;
  created_at: string;
}

const actionIcons: Record<string, React.ReactNode> = {
  delete: <Trash2 className="h-4 w-4 text-destructive" />,
  update: <Edit className="h-4 w-4 text-amber-500" />,
  create: <Plus className="h-4 w-4 text-green-500" />,
  regenerate: <RefreshCw className="h-4 w-4 text-blue-500" />,
};

const actionVariants: Record<string, "destructive" | "secondary" | "default" | "outline"> = {
  delete: "destructive",
  update: "secondary",
  create: "default",
  regenerate: "outline",
};

export function AuditLogTab() {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return data as AuditEntry[];
    },
  });

  const getSummaryText = (entry: AuditEntry) => {
    if (!entry.resource_summary) return "—";
    const s = entry.resource_summary;
    const parts: string[] = [];
    if (s.patient_name) parts.push(String(s.patient_name));
    if (s.patient_email) parts.push(String(s.patient_email));
    if (s.amount_cents) {
      const amt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(s.amount_cents) / 100);
      parts.push(amt);
    }
    if (s.status) parts.push(`Status: ${s.status}`);
    if (s.name) parts.push(String(s.name));
    return parts.join(" · ") || JSON.stringify(s).slice(0, 100);
  };

  return (
    <div className="space-y-6">
      <Card className="card-premium overflow-hidden">
        <CardHeader className="border-b border-border bg-muted/30">
          <CardTitle className="text-lg">
            Audit Log
            {entries.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({entries.length} entries)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No audit entries yet. Actions like deletions will appear here.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(entry.created_at), "MMM d, yyyy h:mm a")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.admin_email || "System"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {actionIcons[entry.action] || null}
                        <Badge variant={actionVariants[entry.action] || "secondary"}>
                          {entry.action}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="capitalize">{entry.resource_type}</span>
                      {entry.resource_id && (
                        <span className="text-xs text-muted-foreground ml-1 font-mono">
                          ({entry.resource_id.slice(0, 8)})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                      {getSummaryText(entry)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
