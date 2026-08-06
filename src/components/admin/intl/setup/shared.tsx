import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { COUNTRY_LABEL } from "@/lib/intlMoney";

export const COUNTRIES = ["MX", "CO", "CL"] as const;
export const CURRENCY_BY_COUNTRY: Record<string, string> = { MX: "MXN", CO: "COP", CL: "CLP" };
export const TZ_BY_COUNTRY: Record<string, string> = {
  MX: "America/Mexico_City",
  CO: "America/Bogota",
  CL: "America/Santiago",
};

export function countryLabel(code?: string | null) {
  return (code && COUNTRY_LABEL[code]) || code || "—";
}

/** Small shared shell so every setup section looks the same. */
export function SectionCard({
  title, description, action, children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-sm text-muted-foreground py-8">
        {text}
      </TableCell>
    </TableRow>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
