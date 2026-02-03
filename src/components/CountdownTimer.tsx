import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface CountdownTimerProps {
  expiresAt: Date;
  onExpire?: () => void;
  className?: string;
}

interface TimeLeft {
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

function calculateTimeLeft(expiresAt: Date): TimeLeft {
  const difference = expiresAt.getTime() - new Date().getTime();
  
  if (difference <= 0) {
    return { hours: 0, minutes: 0, seconds: 0, expired: true };
  }
  
  return {
    hours: Math.floor(difference / (1000 * 60 * 60)),
    minutes: Math.floor((difference / 1000 / 60) % 60),
    seconds: Math.floor((difference / 1000) % 60),
    expired: false,
  };
}

export function CountdownTimer({ expiresAt, onExpire, className }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => calculateTimeLeft(expiresAt));

  useEffect(() => {
    const timer = setInterval(() => {
      const newTimeLeft = calculateTimeLeft(expiresAt);
      setTimeLeft(newTimeLeft);
      
      if (newTimeLeft.expired && onExpire) {
        onExpire();
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  const formatNumber = (num: number) => num.toString().padStart(2, '0');
  
  const isUrgent = timeLeft.hours < 2 && !timeLeft.expired;

  if (timeLeft.expired) {
    return (
      <div className={cn("text-center", className)}>
        <p className="text-destructive font-medium">This link has expired</p>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center justify-center gap-3", className)}>
      <div className="countdown-box">
        <span className={cn("countdown-value", isUrgent && "text-destructive")}>
          {formatNumber(timeLeft.hours)}
        </span>
        <span className="countdown-label">Hours</span>
      </div>
      <span className="text-2xl font-light text-muted-foreground">:</span>
      <div className="countdown-box">
        <span className={cn("countdown-value", isUrgent && "text-destructive")}>
          {formatNumber(timeLeft.minutes)}
        </span>
        <span className="countdown-label">Minutes</span>
      </div>
      <span className="text-2xl font-light text-muted-foreground">:</span>
      <div className="countdown-box">
        <span className={cn("countdown-value tabular-nums", isUrgent && "text-destructive")}>
          {formatNumber(timeLeft.seconds)}
        </span>
        <span className="countdown-label">Seconds</span>
      </div>
    </div>
  );
}
