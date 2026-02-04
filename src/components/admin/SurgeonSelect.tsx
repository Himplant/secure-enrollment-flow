import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface Surgeon {
  id: string;
  name: string;
  specialty: string | null;
}

interface SurgeonSelectProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function SurgeonSelect({
  value,
  onValueChange,
  placeholder = "Select surgeon",
  disabled = false,
}: SurgeonSelectProps) {
  const { data: surgeons = [], isLoading } = useQuery({
    queryKey: ["surgeons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surgeons")
        .select("id, name, specialty")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data as Surgeon[];
    },
  });

  if (isLoading) {
    return <Skeleton className="h-10 w-full" />;
  }

  return (
    <Select
      value={value || "none"}
      onValueChange={(v) => onValueChange(v === "none" ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No surgeon assigned</SelectItem>
        {surgeons.map((surgeon) => (
          <SelectItem key={surgeon.id} value={surgeon.id}>
            {surgeon.name}
            {surgeon.specialty && (
              <span className="text-muted-foreground ml-1">
                ({surgeon.specialty})
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
