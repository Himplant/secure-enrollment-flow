import { cn } from "@/lib/utils";
import {
  CONSULTATION_STATUS_META,
  PAYMENT_STATUS_META,
  SURGERY_STATUS_META,
  toneClass,
  type IntlConsultationStatus,
  type IntlPaymentStatus,
  type IntlSurgeryStatus,
} from "@/lib/intlStatus";

type Props =
  | { kind: "payment"; status: IntlPaymentStatus; className?: string }
  | { kind: "consultation"; status: IntlConsultationStatus; className?: string }
  | { kind: "surgery"; status: IntlSurgeryStatus; className?: string };

/** Status pill for international records. The U.S. StatusBadge stays untouched. */
export function IntlStatusBadge(props: Props) {
  const meta =
    props.kind === "payment"
      ? PAYMENT_STATUS_META[props.status]
      : props.kind === "consultation"
        ? CONSULTATION_STATUS_META[props.status]
        : SURGERY_STATUS_META[props.status];

  if (!meta) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap",
        toneClass(meta.tone),
        props.className,
      )}
    >
      {meta.label}
    </span>
  );
}
