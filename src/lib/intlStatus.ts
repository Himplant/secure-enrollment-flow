/** Display metadata for international consultation statuses. */

export type IntlPaymentStatus =
  | "draft"
  | "link_created"
  | "link_sent"
  | "link_opened"
  | "processing"
  | "approved"
  | "failed"
  | "expired"
  | "canceled"
  | "refunded"
  | "disputed";

export type IntlConsultationStatus =
  | "draft"
  | "awaiting_payment"
  | "awaiting_clinic_contact"
  | "patient_contacted"
  | "scheduled"
  | "rescheduled"
  | "completed"
  | "no_show"
  | "patient_canceled"
  | "clinic_canceled"
  | "closed_lost";

export type IntlSurgeryStatus = "none" | "recommended" | "scheduled" | "completed" | "declined";

type Tone = "neutral" | "info" | "warning" | "success" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-accent text-accent-foreground",
  warning: "bg-warning/20 text-warning-foreground border border-warning/30",
  success: "bg-success/20 text-success border border-success/30",
  danger: "bg-destructive/20 text-destructive border border-destructive/30",
};

export const PAYMENT_STATUS_META: Record<IntlPaymentStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  link_created: { label: "Link created", tone: "neutral" },
  link_sent: { label: "Link sent", tone: "info" },
  link_opened: { label: "Link opened", tone: "info" },
  processing: { label: "Processing", tone: "warning" },
  approved: { label: "Paid", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  canceled: { label: "Canceled", tone: "neutral" },
  refunded: { label: "Refunded", tone: "warning" },
  disputed: { label: "Disputed", tone: "danger" },
};

export const CONSULTATION_STATUS_META: Record<IntlConsultationStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  awaiting_payment: { label: "Awaiting payment", tone: "warning" },
  awaiting_clinic_contact: { label: "Awaiting clinic contact", tone: "info" },
  patient_contacted: { label: "Patient contacted", tone: "info" },
  scheduled: { label: "Scheduled", tone: "info" },
  rescheduled: { label: "Rescheduled", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  no_show: { label: "No show", tone: "danger" },
  patient_canceled: { label: "Patient canceled", tone: "neutral" },
  clinic_canceled: { label: "Clinic canceled", tone: "neutral" },
  closed_lost: { label: "Closed lost", tone: "neutral" },
};

export const SURGERY_STATUS_META: Record<IntlSurgeryStatus, { label: string; tone: Tone }> = {
  none: { label: "—", tone: "neutral" },
  recommended: { label: "Recommended", tone: "info" },
  scheduled: { label: "Surgery scheduled", tone: "info" },
  completed: { label: "Surgery completed", tone: "success" },
  declined: { label: "Declined", tone: "neutral" },
};

export function toneClass(tone: Tone): string {
  return TONE_CLASS[tone];
}
