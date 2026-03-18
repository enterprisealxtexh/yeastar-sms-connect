import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Phone, ArrowDownRight, ArrowUpRight, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import type { CallRecord } from "@/hooks/useCallRecords";
import { formatTimeOnlyNairobi } from "@/lib/dateUtils";

interface CallsSummaryPanelProps {
  calls: CallRecord[];
}

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m${secs > 0 ? ` ${secs}s` : ""}`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${mins > 0 ? ` ${mins}m` : ""}`;
};

const formatTime = (dateString: string): string => {
  if (!dateString) return '-';
  try {
    if (typeof dateString === 'string') {
      if (dateString.includes(' ') && !dateString.includes('Z') && !dateString.includes('+') && !dateString.includes('-', 10)) {
        const utcString = dateString.replace(' ', 'T') + 'Z';
        const date = new Date(utcString);
        return date.toLocaleString('en-US', {
          timeZone: 'Africa/Nairobi',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
      }
    }
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      timeZone: 'Africa/Nairobi',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return formatTimeOnlyNairobi(dateString);
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case "answered":
      return <CheckCircle2 className="w-3 h-3 text-success" />;
    case "missed":
      return <AlertCircle className="w-3 h-3 text-destructive" />;
    default:
      return <AlertCircle className="w-3 h-3 text-warning" />;
  }
};

const getStatusBadge = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "answered":
      return "default";
    case "missed":
      return "destructive";
    case "busy":
      return "outline";
    default:
      return "secondary";
  }
};

export const CallsSummaryPanel = ({ calls }: CallsSummaryPanelProps) => {
  // Get the last 10 recent calls
  const recentCalls = calls.slice(0, 10);

  return (
    <Card className="card-glow border-border/50 bg-card h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
            <Phone className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Recent Calls</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Last 10 calls</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[340px]">
          {recentCalls.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[150px] text-muted-foreground p-4">
              <Phone className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">No calls recorded</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {recentCalls.map((call) => {
                // Determine which extension this call belongs to
                const extensionNumber = call.direction === "inbound" ? call.callee_number : call.caller_number;
                const extensionName = call.direction === "inbound" 
                  ? call.callee_extension_username 
                  : call.caller_extension_username;
                const otherNumber = call.direction === "inbound" ? call.caller_number : call.callee_number;

                return (
                  <div key={call.id} className="px-4 py-3 hover:bg-muted/30 transition-colors border-b border-border/30 last:border-b-0">
                    <div className="grid grid-cols-12 gap-6 items-center">
                      {/* Direction + Extension Info - 3 cols */}
                      <div className="col-span-3 flex items-center gap-2">
                        {call.direction === "inbound" ? (
                          <ArrowDownRight className="w-4 h-4 text-blue-500 shrink-0" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4 text-green-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-sm font-bold text-primary">{extensionNumber}</span>
                            {extensionName && (
                              <span className="text-xs text-muted-foreground truncate">{extensionName}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Other Number - 3 cols with extra left margin */}
                      <div className="col-span-3 text-xs text-muted-foreground font-mono truncate ml-4">
                        {call.direction === "inbound" ? "From" : "To"}: {otherNumber}
                      </div>

                      {/* Duration - 2 cols */}
                      <div className="col-span-2 text-xs font-mono font-semibold text-center">
                        {formatDuration(call.total_duration)}
                      </div>

                      {/* Status - 2 cols */}
                      <div className="col-span-2 flex items-center justify-center gap-1">
                        {getStatusIcon(call.status)}
                        <Badge variant={getStatusBadge(call.status)} className="text-xs capitalize px-2 py-0.5">
                          {call.status}
                        </Badge>
                      </div>

                      {/* Time - 2 cols pushed far right */}
                      <div className="col-span-2 text-xs font-mono text-right pr-2">
                        {formatTime(call.start_time)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
