import { CheckCircle2, XCircle, Timer, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StatusType = 'success' | 'processing' | 'failed' | 'expired' | 'invalid';

interface EnrollmentStatusProps {
  type: StatusType;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

const statusIcons: Record<StatusType, React.ElementType> = {
  success: CheckCircle2,
  processing: Loader2,
  failed: XCircle,
  expired: Timer,
  invalid: AlertCircle,
};

const statusStyles: Record<StatusType, {
  iconClass: string;
  bgClass: string;
}> = {
  success: {
    iconClass: "text-success",
    bgClass: "bg-success/10",
  },
  processing: {
    iconClass: "text-processing animate-spin",
    bgClass: "bg-processing/10",
  },
  failed: {
    iconClass: "text-destructive",
    bgClass: "bg-destructive/10",
  },
  expired: {
    iconClass: "text-muted-foreground",
    bgClass: "bg-muted",
  },
  invalid: {
    iconClass: "text-destructive",
    bgClass: "bg-destructive/10",
  },
};

export function EnrollmentStatus({
  type,
  title,
  message,
  actionLabel,
  onAction,
  className,
}: EnrollmentStatusProps) {
  const Icon = statusIcons[type];
  const styles = statusStyles[type];

  return (
    <div className={cn(
      "flex flex-col items-center text-center max-w-md mx-auto animate-fade-in",
      className
    )}>
      <div className={cn(
        "w-20 h-20 rounded-full flex items-center justify-center mb-6",
        styles.bgClass
      )}>
        <Icon className={cn("h-10 w-10", styles.iconClass)} />
      </div>

      <h1 className="text-2xl font-semibold text-foreground mb-3">
        {title}
      </h1>

      <p className="text-muted-foreground leading-relaxed mb-6">
        {message}
      </p>

      {actionLabel && onAction && (
        <Button 
          variant={type === 'success' ? 'outline' : 'default'}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
