import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeftRight, Check, X, Clock, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  useSwapRequests,
  useCreateSwapRequest,
  useApproveSwapRequest,
  useRejectSwapRequest,
  type ShiftSwapRequest,
} from "@/hooks/useShiftSwap";
import { useAgents, useWeekSchedule, type Agent, type ShiftScheduleEntry } from "@/hooks/useAgents";
import { startOfWeek, endOfWeek, addDays } from "date-fns";

const SWAP_REASONS = [
  "Personal commitment",
  "Family emergency",
  "Medical appointment",
  "Study / Exam",
  "Travel conflict",
  "Mutual agreement",
  "Other",
];

export const ShiftSwapPanel = () => {
  const { data: swapRequests = [], isLoading } = useSwapRequests();
  const { data: agents = [] } = useAgents();
  const approveSwap = useApproveSwapRequest();
  const rejectSwap = useRejectSwapRequest();
  const createSwap = useCreateSwapRequest();

  // Week schedule for swap creation
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 13); // two weeks ahead
  const { data: weekSchedule = [] } = useWeekSchedule(
    format(weekStart, "yyyy-MM-dd"),
    format(weekEnd, "yyyy-MM-dd")
  );

  // Create swap dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [requesterAgentId, setRequesterAgentId] = useState("");
  const [requesterShiftId, setRequesterShiftId] = useState("");
  const [targetAgentId, setTargetAgentId] = useState("");
  const [targetShiftId, setTargetShiftId] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const [customReason, setCustomReason] = useState("");

  // Review dialog
  const [reviewDialog, setReviewDialog] = useState<{ open: boolean; request: ShiftSwapRequest | null; action: "approve" | "reject" }>({
    open: false,
    request: null,
    action: "approve",
  });
  const [reviewNote, setReviewNote] = useState("");

  const pendingRequests = swapRequests.filter((r) => r.status === "pending");
  const processedRequests = swapRequests.filter((r) => r.status !== "pending");

  const requesterShifts = weekSchedule.filter((s) => s.agent_id === requesterAgentId);
  const targetShifts = weekSchedule.filter((s) => s.agent_id === targetAgentId);

  const handleCreateSwap = () => {
    const finalReason = swapReason === "Other" ? customReason : swapReason;
    if (!finalReason.trim()) return;

    const reqAgent = agents.find((a) => a.id === requesterAgentId)!;
    const tgtAgent = agents.find((a) => a.id === targetAgentId)!;
    const reqShift = weekSchedule.find((s) => s.id === requesterShiftId)!;
    const tgtShift = weekSchedule.find((s) => s.id === targetShiftId)!;

    createSwap.mutate({
      requesterAgentId,
      requesterShiftId,
      targetAgentId,
      targetShiftId,
      reason: finalReason,
      requesterAgent: reqAgent,
      targetAgent: tgtAgent,
      requesterShift: reqShift,
      targetShift: tgtShift,
    });

    setCreateDialogOpen(false);
    resetCreateForm();
  };

  const resetCreateForm = () => {
    setRequesterAgentId("");
    setRequesterShiftId("");
    setTargetAgentId("");
    setTargetShiftId("");
    setSwapReason("");
    setCustomReason("");
  };

  const handleReview = () => {
    if (!reviewDialog.request) return;
    if (reviewDialog.action === "approve") {
      approveSwap.mutate({ request: reviewDialog.request, reviewNote: reviewNote || undefined });
    } else {
      rejectSwap.mutate({ request: reviewDialog.request, reviewNote: reviewNote || undefined });
    }
    setReviewDialog({ open: false, request: null, action: "approve" });
    setReviewNote("");
  };

  const formatShift = (shift?: ShiftScheduleEntry) => {
    if (!shift) return "—";
    return `${shift.shift_date} ${shift.start_time}–${shift.end_time}`;
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="text-warning border-warning/50"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "approved":
        return <Badge className="bg-chart-2 text-primary-foreground"><Check className="w-3 h-3 mr-1" />Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive"><X className="w-3 h-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4" />
                Shift Swap Requests
              </CardTitle>
              <CardDescription>Agents can request to swap shifts. Supervisors approve or reject.</CardDescription>
            </div>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <ArrowLeftRight className="w-4 h-4 mr-2" />
              New Swap Request
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Pending Requests */}
          {pendingRequests.length > 0 && (
            <div className="mb-6">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Pending Approval ({pendingRequests.length})
              </h4>
              <div className="space-y-2">
                {pendingRequests.map((req) => (
                  <div key={req.id} className="flex items-center justify-between p-3 rounded-lg border border-accent bg-accent/20">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span>{req.requester_agent?.name}</span>
                        <ArrowLeftRight className="w-3 h-3 text-muted-foreground" />
                        <span>{req.target_agent?.name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                        <div>{req.requester_agent?.name}: {formatShift(req.requester_shift)}</div>
                        <div>{req.target_agent?.name}: {formatShift(req.target_shift)}</div>
                        <div className="italic">Reason: {req.reason}</div>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Requested {format(new Date(req.created_at), "MMM d, HH:mm")}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 ml-4">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-chart-2 border-chart-2/50 hover:bg-chart-2/10"
                        onClick={() => { setReviewDialog({ open: true, request: req, action: "approve" }); setReviewNote(""); }}
                      >
                        <Check className="w-3 h-3 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/50 hover:bg-destructive/10"
                        onClick={() => { setReviewDialog({ open: true, request: req, action: "reject" }); setReviewNote(""); }}
                      >
                        <X className="w-3 h-3 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* History */}
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            History
          </h4>
          {isLoading ? (
            <div className="text-sm text-muted-foreground text-center py-4">Loading...</div>
          ) : processedRequests.length === 0 && pendingRequests.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No swap requests yet. Click "New Swap Request" to create one.
            </div>
          ) : processedRequests.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">No processed requests yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agents</TableHead>
                  <TableHead>Shifts</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processedRequests.slice(0, 20).map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="text-sm">
                      <span className="font-medium">{req.requester_agent?.name}</span>
                      <span className="text-muted-foreground mx-1">↔</span>
                      <span className="font-medium">{req.target_agent?.name}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>{formatShift(req.requester_shift)}</div>
                      <div>{formatShift(req.target_shift)}</div>
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={req.reason}>{req.reason}</TableCell>
                    <TableCell>{statusBadge(req.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(req.created_at), "MMM d")}
                      {req.review_note && (
                        <div className="flex items-center gap-1 mt-0.5 italic" title={req.review_note}>
                          <MessageSquare className="w-2.5 h-2.5" />
                          {req.review_note.slice(0, 30)}{req.review_note.length > 30 ? "…" : ""}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Swap Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => { setCreateDialogOpen(open); if (!open) resetCreateForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-primary" />
              New Shift Swap Request
            </DialogTitle>
            <DialogDescription>Select two agents and their shifts to swap.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Requester */}
            <div className="space-y-2">
              <Label>Requesting Agent</Label>
              <Select value={requesterAgentId} onValueChange={(v) => { setRequesterAgentId(v); setRequesterShiftId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {requesterAgentId && (
              <div className="space-y-2">
                <Label>Their Shift</Label>
                <Select value={requesterShiftId} onValueChange={setRequesterShiftId}>
                  <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                  <SelectContent>
                    {requesterShifts.length === 0 ? (
                      <SelectItem value="__none" disabled>No scheduled shifts</SelectItem>
                    ) : (
                      requesterShifts.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.shift_date} · {s.start_time}–{s.end_time}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Target */}
            <div className="space-y-2">
              <Label>Swap With Agent</Label>
              <Select value={targetAgentId} onValueChange={(v) => { setTargetAgentId(v); setTargetShiftId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                <SelectContent>
                  {agents.filter((a) => a.id !== requesterAgentId).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {targetAgentId && (
              <div className="space-y-2">
                <Label>Their Shift</Label>
                <Select value={targetShiftId} onValueChange={setTargetShiftId}>
                  <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                  <SelectContent>
                    {targetShifts.length === 0 ? (
                      <SelectItem value="__none" disabled>No scheduled shifts</SelectItem>
                    ) : (
                      targetShifts.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.shift_date} · {s.start_time}–{s.end_time}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Reason */}
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={swapReason} onValueChange={setSwapReason}>
                <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>
                  {SWAP_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {swapReason === "Other" && (
              <div className="space-y-2">
                <Label>Custom Reason</Label>
                <Textarea value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="Describe the reason..." rows={2} />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCreateDialogOpen(false); resetCreateForm(); }}>Cancel</Button>
            <Button
              onClick={handleCreateSwap}
              disabled={
                !requesterAgentId || !requesterShiftId || !targetAgentId || !targetShiftId ||
                !swapReason || (swapReason === "Other" && !customReason.trim()) ||
                createSwap.isPending
              }
            >
              {createSwap.isPending ? "Submitting..." : "Submit Swap Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={reviewDialog.open} onOpenChange={(open) => setReviewDialog({ open, request: open ? reviewDialog.request : null, action: reviewDialog.action })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {reviewDialog.action === "approve" ? (
                <><Check className="w-4 h-4 text-chart-2" /> Approve Swap</>
              ) : (
                <><X className="w-4 h-4 text-destructive" /> Reject Swap</>
              )}
            </DialogTitle>
            <DialogDescription>
              {reviewDialog.request && (
                <>
                  {reviewDialog.request.requester_agent?.name} ↔ {reviewDialog.request.target_agent?.name}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {reviewDialog.request && (
              <div className="text-xs text-muted-foreground space-y-1 p-3 rounded-md bg-muted">
                <div><strong>{reviewDialog.request.requester_agent?.name}:</strong> {formatShift(reviewDialog.request.requester_shift)}</div>
                <div><strong>{reviewDialog.request.target_agent?.name}:</strong> {formatShift(reviewDialog.request.target_shift)}</div>
                <div className="italic mt-1">Reason: {reviewDialog.request.reason}</div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Supervisor Note (optional)</Label>
              <Textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Add a note..." rows={2} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReviewDialog({ open: false, request: null, action: "approve" })}>Cancel</Button>
            <Button
              variant={reviewDialog.action === "approve" ? "default" : "destructive"}
              onClick={handleReview}
              disabled={approveSwap.isPending || rejectSwap.isPending}
            >
              {reviewDialog.action === "approve" ? "Approve & Swap Shifts" : "Reject Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
