import { useState } from "react";
import { Search, Filter, X, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

export interface EnrollmentFilters {
  search: string;
  status: string;
  paymentMethod: string;
  amountMin: string;
  amountMax: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
}

interface EnrollmentFiltersProps {
  filters: EnrollmentFilters;
  onChange: (filters: EnrollmentFilters) => void;
  onRefresh: () => void;
}

export function EnrollmentFiltersComponent({ filters, onChange, onRefresh }: EnrollmentFiltersProps) {
  const [isDateFromOpen, setIsDateFromOpen] = useState(false);
  const [isDateToOpen, setIsDateToOpen] = useState(false);

  const updateFilter = <K extends keyof EnrollmentFilters>(key: K, value: EnrollmentFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onChange({
      search: "",
      status: "all",
      paymentMethod: "all",
      amountMin: "",
      amountMax: "",
      dateFrom: undefined,
      dateTo: undefined,
    });
  };

  const activeFilterCount = [
    filters.status !== "all",
    filters.paymentMethod !== "all",
    filters.amountMin !== "",
    filters.amountMax !== "",
    filters.dateFrom !== undefined,
    filters.dateTo !== undefined,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or token..."
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Status filter */}
        <Select value={filters.status} onValueChange={(v) => updateFilter("status", v)}>
          <SelectTrigger className="w-full lg:w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="opened">Opened</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
          </SelectContent>
        </Select>

        {/* Payment method filter */}
        <Select value={filters.paymentMethod} onValueChange={(v) => updateFilter("paymentMethod", v)}>
          <SelectTrigger className="w-full lg:w-44">
            <SelectValue placeholder="Payment Method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Methods</SelectItem>
            <SelectItem value="card">Card</SelectItem>
            <SelectItem value="ach">ACH</SelectItem>
          </SelectContent>
        </Select>

        {/* Advanced filters popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" />
              More Filters
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-4">
              <div className="font-medium">Advanced Filters</div>
              
              {/* Amount range */}
              <div className="space-y-2">
                <Label>Amount Range (USD)</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    placeholder="Min"
                    value={filters.amountMin}
                    onChange={(e) => updateFilter("amountMin", e.target.value)}
                    className="w-24"
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="number"
                    placeholder="Max"
                    value={filters.amountMax}
                    onChange={(e) => updateFilter("amountMax", e.target.value)}
                    className="w-24"
                  />
                </div>
              </div>

              {/* Date range */}
              <div className="space-y-2">
                <Label>Date Range</Label>
                <div className="flex gap-2">
                  <Popover open={isDateFromOpen} onOpenChange={setIsDateFromOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        <Calendar className="mr-2 h-4 w-4" />
                        {filters.dateFrom ? format(filters.dateFrom, "MMM d, yyyy") : "From"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={filters.dateFrom}
                        onSelect={(date) => {
                          updateFilter("dateFrom", date);
                          setIsDateFromOpen(false);
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>

                  <Popover open={isDateToOpen} onOpenChange={setIsDateToOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        <Calendar className="mr-2 h-4 w-4" />
                        {filters.dateTo ? format(filters.dateTo, "MMM d, yyyy") : "To"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={filters.dateTo}
                        onSelect={(date) => {
                          updateFilter("dateTo", date);
                          setIsDateToOpen(false);
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {activeFilterCount > 0 && (
                <Button variant="ghost" className="w-full" onClick={clearFilters}>
                  <X className="h-4 w-4 mr-2" />
                  Clear All Filters
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Button variant="outline" onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      {/* Active filter badges */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-2">
          {filters.dateFrom && (
            <Badge variant="secondary" className="gap-1">
              From: {format(filters.dateFrom, "MMM d")}
              <X className="h-3 w-3 cursor-pointer" onClick={() => updateFilter("dateFrom", undefined)} />
            </Badge>
          )}
          {filters.dateTo && (
            <Badge variant="secondary" className="gap-1">
              To: {format(filters.dateTo, "MMM d")}
              <X className="h-3 w-3 cursor-pointer" onClick={() => updateFilter("dateTo", undefined)} />
            </Badge>
          )}
          {filters.amountMin && (
            <Badge variant="secondary" className="gap-1">
              Min: ${filters.amountMin}
              <X className="h-3 w-3 cursor-pointer" onClick={() => updateFilter("amountMin", "")} />
            </Badge>
          )}
          {filters.amountMax && (
            <Badge variant="secondary" className="gap-1">
              Max: ${filters.amountMax}
              <X className="h-3 w-3 cursor-pointer" onClick={() => updateFilter("amountMax", "")} />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
