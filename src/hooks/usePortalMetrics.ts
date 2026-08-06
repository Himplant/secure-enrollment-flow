import { useQuery } from "@tanstack/react-query";
import { invokePortal } from "./usePortalConsultations";

export interface PortalMetricGroup {
  links_created: number;
  payments_approved: number;
  payments_pending: number;
  awaiting_contact: number;
  median_hours_to_first_contact: number | null;
  median_hours_to_scheduled: number | null;
  consultations_scheduled: number;
  consultations_completed: number;
  no_show_rate: number;
  surgery_recommended_rate: number;
  surgery_scheduled_rate: number;
  surgery_completed_rate: number;
  refund_rate: number;
  dispute_rate: number;
  payment_conversion_rate: number;
  gross_paid_minor_by_currency: Record<string, number>;
}

export interface PortalMetricsPayload {
  totals: PortalMetricGroup;
  by_surgeon: (PortalMetricGroup & { surgeon_id: string; surgeon_name: string })[];
  by_country: (PortalMetricGroup & { country: string })[];
  surgeons: { id: string; name: string; city: string | null; country: string }[];
}

/** Scoped analytics. The server derives the surgeon scope; the client cannot widen it. */
export function usePortalMetrics(filters: { surgeonId?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ["portal-metrics", filters],
    staleTime: 30_000,
    queryFn: () =>
      invokePortal<PortalMetricsPayload>("intl-portal-metrics", {
        surgeon_id: filters.surgeonId || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      }),
  });
}
