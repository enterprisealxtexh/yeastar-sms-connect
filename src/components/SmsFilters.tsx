import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Calendar } from "@/components/ui/calendar";
import { Search, Filter, CalendarIcon, X, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { SmsCategory } from "@/components/SmsCategoryBadge";
import { getPortLabel, type PortLabel } from "@/hooks/usePortLabels";

export interface SmsFiltersState {
  search: string;
  simPort: string;
  status: string;
  category: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
}

interface SmsFiltersProps {
  filters: SmsFiltersState;
  onFiltersChange: (filters: SmsFiltersState) => void;
  simPorts: number[];
  portLabels?: Record<number, PortLabel>;
}

export const SmsFilters = ({ filters, onFiltersChange, simPorts, portLabels }: SmsFiltersProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const updateFilter = <K extends keyof SmsFiltersState>(
    key: K,
    value: SmsFiltersState[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onFiltersChange({
      search: "",
      simPort: "all",
      status: "all",
      category: "all",
      dateFrom: undefined,
      dateTo: undefined,
    });
  };

  const hasActiveFilters =
    filters.search ||
    filters.simPort !== "all" ||
    filters.status !== "all" ||
    filters.category !== "all" ||
    filters.dateFrom ||
    filters.dateTo;

  return (
    <div className="space-y-3">
      {/* Search Bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by sender or message content..."
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            className="pl-9 bg-muted/50 border-border/50"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "shrink-0",
            isExpanded && "bg-primary text-primary-foreground"
          )}
        >
          <Filter className="w-4 h-4" />
        </Button>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="icon"
            onClick={clearFilters}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Expanded Filters */}
      {isExpanded && (
        <div className="grid gap-3 sm:grid-cols-5 p-3 rounded-lg bg-muted/30 border border-border/30">
          {/* SIM Port Filter */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">SIM Port</label>
            <Select
              value={filters.simPort}
              onValueChange={(value) => updateFilter("simPort", value)}
            >
              <SelectTrigger className="h-9 bg-background border-border/50">
                <SelectValue placeholder="All ports" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Ports</SelectItem>
                {simPorts.map((port) => {
                  const label = getPortLabel(port, portLabels);
                  return (
                    <SelectItem key={port} value={port.toString()}>
                      {label || `Port ${port}`}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Status Filter */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Status</label>
            <Select
              value={filters.status}
              onValueChange={(value) => updateFilter("status", value)}
            >
              <SelectTrigger className="h-9 bg-background border-border/50">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="unread">Unread</SelectItem>
                <SelectItem value="read">Read</SelectItem>
                <SelectItem value="processed">Processed</SelectItem>
            </SelectContent>
          </Select>
          </div>

          {/* Category Filter */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Category
            </label>
            <Select
              value={filters.category}
              onValueChange={(value) => updateFilter("category", value)}
            >
              <SelectTrigger className="h-9 bg-background border-border/50">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="otp">OTP</SelectItem>
                <SelectItem value="marketing">Marketing</SelectItem>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="transactional">Transaction</SelectItem>
                <SelectItem value="notification">Notification</SelectItem>
                <SelectItem value="spam">Spam</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date From */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">From Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full h-9 justify-start text-left font-normal bg-background border-border/50",
                    !filters.dateFrom && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.dateFrom ? (
                    format(filters.dateFrom, "MMM d, yyyy")
                  ) : (
                    <span>Pick a date</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.dateFrom}
                  onSelect={(date) => updateFilter("dateFrom", date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Date To */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">To Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full h-9 justify-start text-left font-normal bg-background border-border/50",
                    !filters.dateTo && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.dateTo ? (
                    format(filters.dateTo, "MMM d, yyyy")
                  ) : (
                    <span>Pick a date</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.dateTo}
                  onSelect={(date) => updateFilter("dateTo", date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
    </div>
  );
};
