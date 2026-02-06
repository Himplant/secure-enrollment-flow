import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Calendar, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { format, subDays, subMonths, startOfMonth, endOfMonth, startOfYear } from "date-fns";

export type DatePreset = "7d" | "30d" | "90d" | "this-month" | "last-month" | "ytd" | "all" | "custom";

interface DateRange {
  from?: Date;
  to?: Date;
}

interface AnalyticsDateFilterProps {
  dateRange: DateRange;
  preset: DatePreset;
  onPresetChange: (preset: DatePreset) => void;
  onDateRangeChange: (range: DateRange) => void;
}

const presets: { value: DatePreset; label: string }[] = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "All Time" },
];

export function getDateRangeForPreset(preset: DatePreset): DateRange {
  const now = new Date();
  switch (preset) {
    case "7d":
      return { from: subDays(now, 7), to: now };
    case "30d":
      return { from: subDays(now, 30), to: now };
    case "90d":
      return { from: subDays(now, 90), to: now };
    case "this-month":
      return { from: startOfMonth(now), to: now };
    case "last-month": {
      const lastMonth = subMonths(now, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    }
    case "ytd":
      return { from: startOfYear(now), to: now };
    case "all":
      return {};
    default:
      return {};
  }
}

export function AnalyticsDateFilter({
  dateRange,
  preset,
  onPresetChange,
  onDateRangeChange,
}: AnalyticsDateFilterProps) {
  const [customOpen, setCustomOpen] = useState(false);

  const handlePreset = (p: DatePreset) => {
    onPresetChange(p);
    if (p !== "custom") {
      onDateRangeChange(getDateRangeForPreset(p));
    }
  };

  const dateLabel = dateRange.from && dateRange.to
    ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d, yyyy")}`
    : "All Time";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <Button
          key={p.value}
          variant={preset === p.value ? "default" : "outline"}
          size="sm"
          className="h-8 text-xs"
          onClick={() => handlePreset(p.value)}
        >
          {p.label}
        </Button>
      ))}
      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={preset === "custom" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => handlePreset("custom")}
          >
            <Calendar className="h-3.5 w-3.5" />
            Custom
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <CalendarPicker
            mode="range"
            selected={dateRange.from && dateRange.to ? { from: dateRange.from, to: dateRange.to } : undefined}
            onSelect={(range) => {
              if (range?.from) {
                onDateRangeChange({ from: range.from, to: range.to || range.from });
              }
            }}
            numberOfMonths={2}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">
        {dateLabel}
      </span>
    </div>
  );
}
