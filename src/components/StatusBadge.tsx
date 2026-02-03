import { cn } from "@/lib/utils";
import { 
  Clock, 
  Send, 
  Eye, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Timer, 
  Ban 
} from "lucide-react";

type EnrollmentStatus = 
  | 'created' 
  | 'sent' 
  | 'opened' 
  | 'processing' 
  | 'paid' 
  | 'failed' 
  | 'expired' 
  | 'canceled';

interface StatusBadgeProps {
  status: EnrollmentStatus;
  className?: string;
}

const statusConfig: Record<EnrollmentStatus, {
  label: string;
  icon: React.ElementType;
  className: string;
}> = {
  created: {
    label: 'Created',
    icon: Clock,
    className: 'bg-muted text-muted-foreground',
  },
  sent: {
    label: 'Sent',
    icon: Send,
    className: 'bg-accent text-accent-foreground',
  },
  opened: {
    label: 'Opened',
    icon: Eye,
    className: 'bg-warning/20 text-warning-foreground border border-warning/30',
  },
  processing: {
    label: 'Processing',
    icon: Loader2,
    className: 'bg-processing/20 text-processing border border-processing/30',
  },
  paid: {
    label: 'Paid',
    icon: CheckCircle2,
    className: 'bg-success/20 text-success border border-success/30',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    className: 'bg-destructive/20 text-destructive border border-destructive/30',
  },
  expired: {
    label: 'Expired',
    icon: Timer,
    className: 'bg-muted/50 text-muted-foreground',
  },
  canceled: {
    label: 'Canceled',
    icon: Ban,
    className: 'bg-muted/50 text-muted-foreground',
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium",
        config.className,
        status === 'processing' && "animate-pulse",
        className
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", status === 'processing' && "animate-spin")} />
      {config.label}
    </span>
  );
}
