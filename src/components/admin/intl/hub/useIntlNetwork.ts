import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { NetworkPayload } from "@/lib/intlNetwork";

async function callNetwork<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("intl-admin-network", { body });
  const payload = data as { error?: string } | null;
  if (error || payload?.error) throw new Error(payload?.error ?? error?.message ?? "Request failed");
  return data as T;
}

export function useIntlNetwork() {
  return useQuery({
    queryKey: ["intl-network"],
    staleTime: 15_000,
    queryFn: () => callNetwork<NetworkPayload>({ action: "status" }),
  });
}

export function useAssignDistributor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { surgeon_id: string; distributor_id: string | null }) =>
      callNetwork<{ ok: true; replaced: number }>({
        action: "assign_surgeon_distributor",
        ...vars,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intl-network"] }),
  });
}

export interface DistributorInput {
  id?: string | null;
  name: string;
  legal_name?: string | null;
  countries: string[];
  primary_contact_email?: string | null;
  primary_contact_phone?: string | null;
  is_active: boolean;
}

export function useSaveDistributor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DistributorInput) =>
      callNetwork<{ ok: true; id: string | null }>({ action: "save_distributor", ...input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intl-network"] }),
  });
}
