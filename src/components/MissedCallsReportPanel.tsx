import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  PhoneMissed,
  Mail,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { useMissedCallReport, useMarkCallbackAttempted, useSendMissedCallEmail, type MissedCallRecord } from "@/hooks/useMissedCallReport";
import { useAutoReplyConfig } from "../hooks/useAutoReplyConfig";
import { usePortLabels, getPortLabel } from "@/hooks/usePortLabels";
import { useExtensions } from "@/hooks/useExtensions";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { SendReportDialog } from "./SendReportDialog";

interface MissedCallsReportPanelProps {
  dateFrom?: Date;
  dateTo?: Date;
  onDateChange?: (from: Date | undefined, to: Date | undefined) => void;
}

export const MissedCallsReportPanel = ({ dateFrom: initialDateFrom, dateTo: initialDateTo, onDateChange }: MissedCallsReportPanelProps) => {
  const [dateFrom, setDateFrom] = useState<Date | undefined>(initialDateFrom);
  const [dateTo, setDateTo] = useState<Date | undefined>(initialDateTo);
  const { data: calls = [], isLoading } = useMissedCallReport();
  const { data: autoConfig } = useAutoReplyConfig();
  const { mutate: markCallback, isPending: isMarking } = useMarkCallbackAttempted();
  const { mutate: sendEmail, isPending: isSendingEmail } = useSendMissedCallEmail();
  const { data: portLabels } = usePortLabels();
  const { getUsername } = useExtensions();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);

  useEffect(() => {
    if (initialDateFrom !== undefined || initialDateTo !== undefined) {
      setDateFrom(initialDateFrom);
      setDateTo(initialDateTo);
    }
  }, [initialDateFrom, initialDateTo]);

  const handleResetDates = () => {
    setDateFrom(undefined);
    setDateTo(undefined);
    onDateChange?.(undefined, undefined);
  };

  const handleSetPreset = (days: number) => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    
    setDateFrom(start);
    setDateTo(end);
    onDateChange?.(start, end);
  };

  // Filter calls by date range
  const filteredCalls = calls.filter((call) => {
    if (!dateFrom && !dateTo) return true;
    const callDate = new Date(call.start_time);
    if (dateFrom && callDate < dateFrom) return false;
    if (dateTo && callDate > dateTo) return false;
    return true;
  });

  const pending = filteredCalls.filter((c) => !c.callback_attempted);
  const completed = filteredCalls.filter((c) => c.callback_attempted);

  const formatExtensionLabel = (extension: string | null) => {
    if (!extension) return null;
    const username = getUsername(extension);
    return username ? `Ext ${extension} · ${username}` : `Ext ${extension}`;
  };

  const handleMarkCallback = (id: string) => {
    markCallback({ id, callback_notes: notes[id] || undefined });
    setExpandedId(null);
  };

  const handleSendEmail = async (call: MissedCallRecord) => {
    const email = autoConfig?.notification_email;
    if (!email) {
      toast.error("No notification email configured. Set it in the Configuration tab → Auto-Reply SMS.");
      return;
    }
    setSendingEmailId(call.id);
    sendEmail(
      { call_id: call.id, to_email: email },
      { onSettled: () => setSendingEmailId(null) }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date Range Filter */}
      <Card className="border-border/50 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold mb-4">Filter by Date Range (Africa/Nairobi Time)</CardTitle>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">From:</label>
              <Input 
                type="date" 
                value={dateFrom ? dateFrom.toISOString().split('T')[0] : ''} 
                onChange={(e) => {
                  const date = e.target.value ? new Date(e.target.value + 'T00:00:00') : undefined;
                  setDateFrom(date);
                }} 
                className="w-[150px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">To:</label>
              <Input 
                type="date" 
                value={dateTo ? dateTo.toISOString().split('T')[0] : ''} 
                onChange={(e) => {
                  const date = e.target.value ? new Date(e.target.value + 'T23:59:59') : undefined;
                  setDateTo(date);
                }} 
                className="w-[150px]"
              />
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => handleSetPreset(7)}>7 Days</Button>
              <Button size="sm" variant="outline" onClick={() => handleSetPreset(30)}>30 Days</Button>
              <Button size="sm" variant="outline" onClick={() => handleSetPreset(90)}>90 Days</Button>
            </div>
            {(dateFrom || dateTo) && (
              <Button size="sm" variant="destructive" onClick={handleResetDates} className="ml-auto gap-1">
                <X className="w-3 h-3" /> Reset
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Header with Send Report button */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Missed Calls Report</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Track and manage missed call callbacks</p>
        </div>
        <Button
          className="gap-2"
          onClick={() => setReportDialogOpen(true)}
        >
          <Send className="w-4 h-4" />
          Send Report
        </Button>
      </div>

      <SendReportDialog open={reportDialogOpen} onOpenChange={setReportDialogOpen} />

      {/* Summary row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-border/50 bg-card">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-destructive/10">
                <PhoneMissed className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pending.length}</p>
                <p className="text-xs text-muted-foreground">Pending Callbacks</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-success/10">
                <CheckCircle2 className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{completed.length}</p>
                <p className="text-xs text-muted-foreground">Callbacks Done</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium truncate">
                  {autoConfig?.notification_email || "Not configured"}
                </p>
                <p className="text-xs text-muted-foreground">Notification email</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending callbacks */}
      <Card className="card-glow border-border/50 bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-destructive/10">
              <PhoneMissed className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Pending Callbacks</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Missed calls that haven't been returned yet
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-success/60" />
              <p className="text-sm font-medium">All caught up!</p>
              <p className="text-xs mt-1">No pending callbacks at this time.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((call) => (
                <div
                  key={call.id}
                  className="rounded-lg border border-border/40 bg-muted/20 overflow-hidden"
                >
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex items-center justify-center w-9 h-9 rounded-full bg-destructive/10 shrink-0">
                        <PhoneMissed className="w-4 h-4 text-destructive" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {call.caller_name || call.caller_number}
                        </p>
                        {call.caller_name && (
                          <p className="text-xs text-muted-foreground font-mono">{call.caller_number}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(call.start_time), "dd MMM yyyy HH:mm")}
                          </span>
                          {call.extension && (
                            <Badge variant="secondary" className="text-xs h-4 px-1">
                              {formatExtensionLabel(call.extension)}
                            </Badge>
                          )}
                          {call.sim_port && (
                            <Badge variant="outline" className="text-xs h-4 px-1">
                              {getPortLabel(call.sim_port, portLabels)}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        disabled={sendingEmailId === call.id || isSendingEmail}
                        onClick={() => handleSendEmail(call)}
                      >
                        {sendingEmailId === call.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Mail className="w-3 h-3" />
                        )}
                        Notify
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2"
                        onClick={() => setExpandedId(expandedId === call.id ? null : call.id)}
                      >
                        {expandedId === call.id ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  {expandedId === call.id && (
                    <div className="border-t border-border/30 p-4 bg-muted/10 space-y-3">
                      <Textarea
                        placeholder="Add a note about this callback (optional)..."
                        rows={2}
                        className="text-sm bg-muted/30 border-border/50 resize-none"
                        value={notes[call.id] || ""}
                        onChange={(e) =>
                          setNotes((prev) => ({ ...prev, [call.id]: e.target.value }))
                        }
                      />
                      <Button
                        size="sm"
                        className="gap-2"
                        disabled={isMarking}
                        onClick={() => handleMarkCallback(call.id)}
                      >
                        {isMarking ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        Mark as Called Back
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completed callbacks */}
      {completed.length > 0 && (
        <Card className="border-border/50 bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-success/10">
                <CheckCircle2 className="w-5 h-5 text-success" />
              </div>
              <CardTitle className="text-base font-semibold">Completed Callbacks</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {completed.slice(0, 20).map((call) => (
                <div
                  key={call.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/10 border border-border/20"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm truncate">
                        {call.caller_name || call.caller_number}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(call.start_time), "dd MMM HH:mm")}
                        {call.callback_notes && ` · ${call.callback_notes}`}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {call.extension && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1">
                            {formatExtensionLabel(call.extension)}
                          </Badge>
                        )}
                        {call.sim_port && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1">
                            {getPortLabel(call.sim_port, portLabels)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-success border-success/30 text-xs shrink-0">
                    Called back
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
