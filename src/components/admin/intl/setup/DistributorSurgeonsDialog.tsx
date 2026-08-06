import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Spinner, countryLabel } from "./shared";

interface Props {
  distributor: { id: string; name: string } | null;
  onClose: () => void;
}

/** Assigns international surgeons to a distributor for oversight/reporting only. */
export function DistributorSurgeonsDialog({ distributor, onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: surgeons, isLoading } = useQuery({
    queryKey: ["intl-surgeons-min"],
    enabled: !!distributor,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surgeons")
        .select("id, name, country")
        .eq("is_international", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: assigned } = useQuery({
    queryKey: ["distributor-surgeons", distributor?.id],
    enabled: !!distributor,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_surgeons")
        .select("surgeon_id")
        .eq("distributor_id", distributor!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.surgeon_id as string);
    },
  });

  const toggle = async (surgeonId: string, checked: boolean) => {
    if (!distributor) return;
    const { error } = checked
      ? await supabase.from("distributor_surgeons").insert({
          distributor_id: distributor.id,
          surgeon_id: surgeonId,
        })
      : await supabase
          .from("distributor_surgeons")
          .delete()
          .eq("distributor_id", distributor.id)
          .eq("surgeon_id", surgeonId);

    if (error) {
      toast({ title: "Could not update", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["distributor-surgeons", distributor.id] });
  };

  return (
    <Dialog open={!!distributor} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Surgeons for {distributor?.name}</DialogTitle>
          <DialogDescription>
            Assigned surgeons appear in this distributor's portal. Payments still settle directly with each surgeon.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Spinner />
        ) : (
          <div className="space-y-2">
            {(surgeons ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No international surgeons yet.</p>
            )}
            {(surgeons ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-3 rounded-md border p-2 text-sm">
                <Checkbox
                  checked={(assigned ?? []).includes(s.id)}
                  onCheckedChange={(v) => toggle(s.id, v === true)}
                />
                <span className="font-medium">{s.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{countryLabel(s.country)}</span>
              </label>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
