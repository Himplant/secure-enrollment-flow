import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Variable } from "lucide-react";

interface PlaceholderInfo {
  key: string;
  label: string;
  description: string;
}

const placeholders: PlaceholderInfo[] = [
  { key: "{{patient_name}}", label: "Patient Name", description: "Full name of the patient" },
  { key: "{{patient_email}}", label: "Patient Email", description: "Email address of the patient" },
  { key: "{{patient_phone}}", label: "Patient Phone", description: "Phone number of the patient" },
  { key: "{{amount}}", label: "Amount", description: "Payment amount (formatted with currency)" },
  { key: "{{deposit_date}}", label: "Deposit Date", description: "Today's date when viewing the document" },
  { key: "{{surgeon_name}}", label: "Surgeon Name", description: "Name of the assigned consulting surgeon" },
  { key: "{{expiration_date}}", label: "Expiration Date", description: "Payment link expiration date" },
];

interface PolicyPlaceholdersProps {
  onInsert: (placeholder: string) => void;
}

export function PolicyPlaceholders({ onInsert }: PolicyPlaceholdersProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Variable className="h-4 w-4" />
          Insert Field
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="space-y-1">
          <p className="text-sm font-medium mb-2">Dynamic Fields</p>
          <p className="text-xs text-muted-foreground mb-3">
            Click a field to insert it at your cursor position
          </p>
          <div className="space-y-1">
            {placeholders.map((p) => (
              <button
                key={p.key}
                onClick={() => onInsert(p.key)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-sm transition-colors"
              >
                <span className="font-mono text-primary">{p.key}</span>
                <p className="text-xs text-muted-foreground">{p.description}</p>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Utility function to replace placeholders with actual values
export function replacePlaceholders(
  text: string,
  data: {
    patient_name?: string | null;
    patient_email?: string | null;
    patient_phone?: string | null;
    amount_cents?: number;
    currency?: string;
    surgeon_name?: string | null;
    expires_at?: string;
  }
): string {
  const formatAmount = (cents: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return text
    .replace(/\{\{patient_name\}\}/g, data.patient_name || "Patient")
    .replace(/\{\{patient_email\}\}/g, data.patient_email || "N/A")
    .replace(/\{\{patient_phone\}\}/g, data.patient_phone || "N/A")
    .replace(
      /\{\{amount\}\}/g,
      data.amount_cents
        ? formatAmount(data.amount_cents, data.currency || "usd")
        : "N/A"
    )
    .replace(/\{\{deposit_date\}\}/g, formatDate(new Date()))
    .replace(/\{\{surgeon_name\}\}/g, data.surgeon_name || "N/A")
    .replace(
      /\{\{expiration_date\}\}/g,
      data.expires_at ? formatDate(new Date(data.expires_at)) : "N/A"
    );
}
