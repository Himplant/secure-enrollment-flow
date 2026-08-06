import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { IntlConsultationStatus, IntlPaymentStatus, IntlSurgeryStatus } from "@/lib/intlStatus";

export interface PortalConsultationRow {
  id: string;
  token_last4: string;
  surgeon_id: string;
  surgeon_id: string | null;
  amount_minor: number;
  currency: string;
  country: string;
  provider: string;
  payment_status: IntlPaymentStatus;
  consultation_status: IntlConsultationStatus;
  surgery_status: IntlSurgeryStatus;
  expires_at: string;
  paid_at: string | null;
  scheduled_at: string | null;
  first_contact_at: string | null;
  rescheduled_count: number;
  outcome_notes: string | null;
  created_at: string;
  patient: { id: string; full_name: string; email: string | null; phone: string | null } | null;
  surgeon: { id: string; name: string } | null;
}

export interface PortalSurgeon {
  id: string;
  name: string;
  city: string | null;
  country: string;
}

interface ListPayload {
  consultations: PortalConsultationRow[];
  surgeons: PortalSurgeon[];
}

export async function invokePortal<T>(fn: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const message = (data as { error?: string } | null)?.error ?? error.message;
    throw new Error(message);
  }
  if ((data as { error?: string } | null)?.error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export function usePortalConsultations(filters: {
  surgeonId?: string;
  paymentStatus?: string;
  consultationStatus?: string;
}) {
  return useQuery({
    queryKey: ["portal-consultations", filters],
    staleTime: 15_000,
    queryFn: () =>
      invokePortal<ListPayload>("intl-portal-consultations", {
        surgeon_id: filters.surgeonId || undefined,
        payment_status: filters.paymentStatus || undefined,
        consultation_status: filters.consultationStatus || undefined,
      }),
  });
}

export interface PortalConsultationDetail {
  consultation: PortalConsultationRow;
  patient: {
    full_name: string;
    email: string | null;
    phone: string | null;
    preferred_language: string;
    notes: string | null;
  } | null;
  surgeon: { id: string; name: string; specialty: string | null; city: string | null; country: string; timezone: string | null } | null;
  
  events: { event_type: string; event_data: unknown; actor_type: string; created_at: string }[];
}

export function usePortalConsultation(consultationId: string | null) {
  return useQuery({
    queryKey: ["portal-consultation", consultationId],
    enabled: !!consultationId,
    queryFn: () =>
      invokePortal<PortalConsultationDetail>("intl-portal-consultations", {
        consultation_id: consultationId,
      }),
  });
}
