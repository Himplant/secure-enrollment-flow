import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserCog, Loader2 } from "lucide-react";

interface Surgeon {
  id: string;
  zoho_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  specialty: string | null;
  is_active: boolean;
}

export function SurgeonManagement() {
  const { data: surgeons = [], isLoading } = useQuery({
    queryKey: ["surgeons-management"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surgeons")
        .select("*")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data as Surgeon[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Surgeons</h2>
        <p className="text-sm text-muted-foreground">
          Active surgeons synced from Zoho CRM
        </p>
      </div>

      {surgeons.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <UserCog className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No active surgeons</h3>
          <p className="text-muted-foreground">
            Surgeons will appear here once synced from Zoho CRM
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Specialty</TableHead>
                <TableHead>Contact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {surgeons.map((surgeon) => (
                <TableRow key={surgeon.id}>
                  <TableCell className="font-medium">{surgeon.name}</TableCell>
                  <TableCell>
                    {surgeon.specialty || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {surgeon.email && <div>{surgeon.email}</div>}
                      {surgeon.phone && (
                        <div className="text-muted-foreground">
                          {surgeon.phone}
                        </div>
                      )}
                      {!surgeon.email && !surgeon.phone && (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
