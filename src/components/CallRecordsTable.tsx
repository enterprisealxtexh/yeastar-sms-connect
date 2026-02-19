import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, Search, Clock, Timer } from "lucide-react";
import { CallStatusBadge, CallDirectionBadge } from "./CallStatusBadge";
import { CallBackButton } from "./CallBackButton";
import { CallRecord } from "@/hooks/useCallRecords";
import { useExtensions } from "@/hooks/useExtensions";
import { formatDateNairobi } from "@/lib/dateUtils";

interface CallRecordsTableProps {
  calls: CallRecord[];
  isLoading: boolean;
}

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds === 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

export const CallRecordsTable = ({ calls, isLoading }: CallRecordsTableProps) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [extensionFilter, setExtensionFilter] = useState<string>("all");
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
      call.callee_extension_username?.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === "all" || call.status === statusFilter;
    const matchesDirection = directionFilter === "all" || call.direction === directionFilter;
    
    // Extension filtering: check if call involves this extension
    // A call involves an extension if:
    // 1. The extension field matches (for internal/PBX calls)
    // 2. The caller_number matches (outbound from extension)
    // 3. The callee_number matches (inbound to extension)
    let matchesExtension = extensionFilter === "all";
    if (extensionFilter !== "all") {
      matchesExtension = 
        call.extension === extensionFilter ||
        call.caller_number === extensionFilter ||
        call.callee_number === extensionFilter;
    }

    return matchesSearch && matchesStatus && matchesDirection && matchesExtension;
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
            <Select value={extensionFilter} onValueChange={setExtensionFilter}>
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="answered">Answered</SelectItem>
                <SelectItem value="missed">Missed</SelectItem>
                <SelectItem value="busy">Busy</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="voicemail">Voicemail</SelectItem>
              </SelectContent>
            </Select>
            <Select value={directionFilter} onValueChange={setDirectionFilter}>
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
                          <CallDirectionBadge direction={call.direction} />
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
                          <CallStatusBadge status={call.status} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatDuration(call.ring_duration)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatDuration(call.talk_duration)}
                        </TableCell>
                        <TableCell className="text-center">
                          <CallBackButton phoneNumber={callBackNumber} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
