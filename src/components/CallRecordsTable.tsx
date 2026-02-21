import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Phone, Search, Clock, Timer, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallRecord } from "@/hooks/useCallRecords";
import { useExtensions } from "@/hooks/useExtensions";
import { formatDateNairobi } from "@/lib/dateUtils";

interface CallRecordsTableProps {
  calls: CallRecord[];
  isLoading: boolean;
  currentPage?: number;
  totalPages?: number;
  totalCount?: number;
  onPageChange?: (page: number) => void;
  extensionFilter?: string;
  onExtensionFilterChange?: (extension: string) => void;
  directionFilter?: string;
  onDirectionFilterChange?: (direction: string) => void;
  statusFilter?: string;
  onStatusFilterChange?: (status: string) => void;
}

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds === 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

export const CallRecordsTable = ({ 
  calls, 
  isLoading,
  currentPage = 1,
  totalPages = 1,
  totalCount = 0,
  onPageChange,
  extensionFilter = "all",
  onExtensionFilterChange,
  directionFilter = "all",
  onDirectionFilterChange,
  statusFilter = "all",
  onStatusFilterChange
}: CallRecordsTableProps) => {
  const [search, setSearch] = useState("");
  const { extensions } = useExtensions();

  const filteredCalls = calls.filter((call) => {
    const callerDisplay = call.caller_extension_username 
      ? `${call.caller_number} ${call.caller_extension_username}`
      : call.caller_number;
    const calleeDisplay = call.callee_extension_username
      ? `${call.callee_number} ${call.callee_extension_username}`
      : call.callee_number;
    
    const matchesSearch =
      call.caller_number.toLowerCase().includes(search.toLowerCase()) ||
      call.callee_number.toLowerCase().includes(search.toLowerCase()) ||
      call.caller_extension_username?.toLowerCase().includes(search.toLowerCase()) ||
      call.callee_extension_username?.toLowerCase().includes(search.toLowerCase()) ||
      calleeDisplay.toLowerCase().includes(search.toLowerCase()) ||
      callerDisplay.toLowerCase().includes(search.toLowerCase());

    // All filtering is now done server-side via the API (extension, direction, status)
    // Client-side search is the only local filtering
    return matchesSearch;
  });

  return (
    <Card className="card-glow border-border/50 bg-card">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Phone className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-base font-semibold">Call Records</CardTitle>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search calls or extensions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-48"
              />
            </div>
            <Select value={extensionFilter} onValueChange={(value) => onExtensionFilterChange?.(value)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Extension" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Extensions</SelectItem>
                {extensions.map((ext) => (
                  <SelectItem key={ext.extnumber} value={ext.extnumber}>
                    {ext.extnumber} - {ext.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange?.(value)}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="answered">Answered</SelectItem>
                <SelectItem value="missed">Missed</SelectItem>
                <SelectItem value="busy">Busy</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={directionFilter} onValueChange={(value) => onDirectionFilterChange?.(value)}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="inbound">Inbound</SelectItem>
                <SelectItem value="outbound">Outbound</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Timer className="w-3 h-3" />
                      Ring
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Clock className="w-3 h-3" />
                      Talk
                    </div>
                  </TableHead>
                  <TableHead className="text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCalls.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No call records found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCalls.map((call) => {
                    // Determine which number to call back based on direction
                    const callBackNumber = call.direction === "inbound" ? call.caller_number : call.callee_number;
                    
                    return (
                      <TableRow key={call.id} className="hover:bg-muted/20">
                        <TableCell className="font-mono text-xs">
                          {formatDateNairobi(call.start_time)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={call.direction === "inbound" ? "default" : "secondary"}>
                            {call.direction}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            {call.caller_extension_username ? (
                              <>
                                <span className="font-semibold text-primary">{call.caller_number}</span>
                                <span className="text-xs text-muted-foreground">{call.caller_extension_username}</span>
                              </>
                            ) : (
                              <span className="font-medium">{call.caller_number}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            {call.callee_extension_username ? (
                              <>
                                <span className="font-semibold text-primary">{call.callee_number}</span>
                                <span className="text-xs text-muted-foreground">{call.callee_extension_username}</span>
                              </>
                            ) : (
                              <span className="font-medium">{call.callee_number}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={call.status === "answered" ? "default" : "destructive"}>
                            {call.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatDuration(call.ring_duration)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatDuration(call.talk_duration)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button size="sm" variant="ghost" title={callBackNumber}>
                            <Phone className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
        {!isLoading && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-muted/20">
            <div className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages} ({totalCount} total calls)
            </div>
            {totalPages > 1 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange?.(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange?.(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="gap-1"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

