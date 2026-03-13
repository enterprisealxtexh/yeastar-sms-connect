import { useState, DragEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useAgents, useWeekSchedule, useCreateSchedule, useDeleteSchedule, useReassignShift, timesOverlap, Agent, ShiftScheduleEntry } from "@/hooks/useAgents";
import { ChevronLeft, ChevronRight, X, GripVertical, RefreshCw, Users, Clock, Pencil, Check } from "lucide-react";
import { toast } from "sonner";
import { format, addDays, startOfWeek, endOfWeek, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

const TIME_SLOTS = [
  { label: "06:00 – 10:00", start: "06:00", end: "10:00" },
  { label: "08:00 – 12:00", start: "08:00", end: "12:00" },
  { label: "08:00 – 17:00", start: "08:00", end: "17:00" },
  { label: "10:00 – 14:00", start: "10:00", end: "14:00" },
  { label: "12:00 – 18:00", start: "12:00", end: "18:00" },
  { label: "14:00 – 20:00", start: "14:00", end: "20:00" },
  { label: "17:00 – 22:00", start: "17:00", end: "22:00" },
  { label: "22:00 – 06:00", start: "22:00", end: "06:00" },
];

const AGENT_COLORS = [
  "bg-chart-1/20 border-chart-1/50 text-chart-1",
  "bg-chart-2/20 border-chart-2/50 text-chart-2",
  "bg-chart-3/20 border-chart-3/50 text-chart-3",
  "bg-chart-4/20 border-chart-4/50 text-chart-4",
  "bg-chart-5/20 border-chart-5/50 text-chart-5",
  "bg-primary/20 border-primary/50 text-primary",
  "bg-accent/40 border-accent text-accent-foreground",
  "bg-secondary border-secondary text-secondary-foreground",
];

const REASSIGN_REASONS = [
  "Agent called in sick",
  "Personal emergency",
  "Schedule conflict",
  "Training / Meeting",
  "Agent unavailable",
  "Performance issue",
  "Shift swap request",
  "Other",
];

export const WeeklyShiftPlanner = () => {
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<string>("08:00 – 17:00");
  const [draggedAgent, setDraggedAgent] = useState<Agent | null>(null);

  // Bulk scheduling state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAgents, setBulkAgents] = useState<Set<string>>(new Set());
  const [bulkDays, setBulkDays] = useState<Set<number>>(new Set());
  const [bulkSlot, setBulkSlot] = useState("08:00 – 17:00");
  const [bulkLoading, setBulkLoading] = useState(false);

  // Inline edit state
  const [editingShift, setEditingShift] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  // Reassign dialog state
  const [reassignDialog, setReassignDialog] = useState<{
    open: boolean;
    entry: ShiftScheduleEntry | null;
  }>({ open: false, entry: null });
  const [reassignAgentId, setReassignAgentId] = useState("");
  const [reassignReasonPreset, setReassignReasonPreset] = useState("");
  const [customReason, setCustomReason] = useState("");

  const baseDate = addDays(new Date(), weekOffset * 7);
  const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(baseDate, { weekStartsOn: 1 });
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  const { data: agents = [] } = useAgents();
  const { data: weekSchedule = [], isLoading } = useWeekSchedule(weekStartStr, weekEndStr);
  const createSchedule = useCreateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const reassignShift = useReassignShift();

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  const agentColorMap = new Map<string, string>();
  agents.forEach((a, i) => agentColorMap.set(a.id, AGENT_COLORS[i % AGENT_COLORS.length]));

  const getScheduleForDay = (date: Date): ShiftScheduleEntry[] => {
    const dateStr = format(date, "yyyy-MM-dd");
    return weekSchedule.filter((s) => s.shift_date === dateStr);
  };

  const handleDragStart = (e: DragEvent, agent: Agent) => {
    setDraggedAgent(agent);
    e.dataTransfer.setData("agent_id", agent.id);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: DragEvent, date: Date) => {
    e.preventDefault();
    const agentId = e.dataTransfer.getData("agent_id");
    if (!agentId) return;

    const slot = TIME_SLOTS.find((s) => `${s.start} – ${s.end}` === selectedSlot) || TIME_SLOTS[2];
    const dateStr = format(date, "yyyy-MM-dd");

    const dayShifts = weekSchedule.filter(
      (s) => s.agent_id === agentId && s.shift_date === dateStr
    );
    const conflict = dayShifts.find((s) =>
      timesOverlap(slot.start, slot.end, s.start_time, s.end_time)
    );
    if (conflict) {
      toast.error(`Conflict: ${conflict.agent?.name || "Agent"} already has ${conflict.start_time}–${conflict.end_time} on this day`);
      setDraggedAgent(null);
      return;
    }

    createSchedule.mutate({
      agent_id: agentId,
      shift_date: dateStr,
      start_time: slot.start,
      end_time: slot.end,
    });
    setDraggedAgent(null);
  };

  const handleRemoveShift = (id: string) => {
    deleteSchedule.mutate(id);
  };

  // -- Bulk scheduling --
  const toggleBulkAgent = (id: string) => {
    setBulkAgents((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleBulkDay = (dayIdx: number) => {
    setBulkDays((prev) => {
      const next = new Set(prev);
      next.has(dayIdx) ? next.delete(dayIdx) : next.add(dayIdx);
      return next;
    });
  };

  const handleBulkSchedule = async () => {
    if (bulkAgents.size === 0 || bulkDays.size === 0) {
      toast.error("Select at least one agent and one day");
      return;
    }

    const slot = TIME_SLOTS.find((s) => `${s.start} – ${s.end}` === bulkSlot) || TIME_SLOTS[2];
    setBulkLoading(true);

    const entries: { agent_id: string; shift_date: string; start_time: string; end_time: string }[] = [];
    let skipped = 0;

    for (const agentId of bulkAgents) {
      for (const dayIdx of bulkDays) {
        const dateStr = format(days[dayIdx], "yyyy-MM-dd");
        const existing = weekSchedule.filter(
          (s) => s.agent_id === agentId && s.shift_date === dateStr
        );
        const conflict = existing.find((s) =>
          timesOverlap(slot.start, slot.end, s.start_time, s.end_time)
        );
        if (conflict) {
          skipped++;
          continue;
        }
        entries.push({
          agent_id: agentId,
          shift_date: dateStr,
          start_time: slot.start,
          end_time: slot.end,
        });
      }
    }

    if (entries.length === 0) {
      toast.error("All combinations have conflicts — no shifts created");
      setBulkLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/shift-schedule/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const json = await response.json().catch(() => ({}));
      setBulkLoading(false);
      if (!response.ok || !json.success) {
        toast.error("Failed to create shifts: " + (json.error || "Unknown error"));
        return;
      }
    } catch (error) {
      setBulkLoading(false);
      toast.error(`Failed to create shifts: ${error instanceof Error ? error.message : "Unknown error"}`);
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["shift-schedule"] });
    queryClient.invalidateQueries({ queryKey: ["week-schedule"] });

    toast.success(`${entries.length} shift(s) created${skipped > 0 ? `, ${skipped} skipped (conflicts)` : ""}`);
    setBulkOpen(false);
    setBulkAgents(new Set());
    setBulkDays(new Set());
  };

  // -- Inline shift time editing --
  const startEditing = (entry: ShiftScheduleEntry) => {
    setEditingShift(entry.id);
    setEditStart(entry.start_time);
    setEditEnd(entry.end_time);
  };

  const saveEditedTime = async (entry: ShiftScheduleEntry) => {
    if (!editStart || !editEnd) return;
    if (editStart === entry.start_time && editEnd === entry.end_time) {
      setEditingShift(null);
      return;
    }

    // Check conflicts with other shifts for same agent on same day
    const dayShifts = weekSchedule.filter(
      (s) => s.agent_id === entry.agent_id && s.shift_date === entry.shift_date && s.id !== entry.id
    );
    const conflict = dayShifts.find((s) =>
      timesOverlap(editStart, editEnd, s.start_time, s.end_time)
    );
    if (conflict) {
      toast.error(`Conflict with ${conflict.start_time}–${conflict.end_time}`);
      return;
    }

    const response = await fetch(`${API_URL}/api/shift-schedule/${entry.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_time: editStart, end_time: editEnd }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.success) {
      toast.error(json.error || "Failed to update shift");
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["shift-schedule"] });
    queryClient.invalidateQueries({ queryKey: ["week-schedule"] });
    toast.success("Shift time updated");
    setEditingShift(null);
  };

  // -- Reassign --
  const openReassignDialog = (entry: ShiftScheduleEntry) => {
    setReassignDialog({ open: true, entry });
    setReassignAgentId("");
    setReassignReasonPreset("");
    setCustomReason("");
  };

  const handleReassign = () => {
    const entry = reassignDialog.entry;
    if (!entry || !reassignAgentId) return;

    const finalReason = reassignReasonPreset === "Other" ? customReason : reassignReasonPreset;
    if (!finalReason.trim()) {
      toast.error("Please provide a reason for the reassignment");
      return;
    }

    const originalAgent = entry.agent || agents.find((a) => a.id === entry.agent_id);
    const newAgent = agents.find((a) => a.id === reassignAgentId);
    if (!originalAgent || !newAgent) return;

    reassignShift.mutate({
      shiftId: entry.id,
      newAgentId: reassignAgentId,
      reason: finalReason,
      originalAgent: originalAgent as Agent,
      newAgent,
      shiftDate: entry.shift_date,
      startTime: entry.start_time,
      endTime: entry.end_time,
    });

    setReassignDialog({ open: false, entry: null });
  };

  const availableAgentsForReassign = reassignDialog.entry
    ? agents.filter((a) => a.id !== reassignDialog.entry!.agent_id)
    : [];

  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <CardTitle className="text-sm font-medium">Weekly Shift Planner</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setBulkOpen(true)}
              >
                <Users className="w-3.5 h-3.5" /> Bulk Schedule
              </Button>
              <Select value={selectedSlot} onValueChange={setSelectedSlot}>
                <SelectTrigger className="w-[180px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_SLOTS.map((slot) => (
                    <SelectItem key={`${slot.start}-${slot.end}`} value={`${slot.start} – ${slot.end}`}>
                      {slot.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset((o) => o - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setWeekOffset(0)}>
                  This Week
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset((o) => o + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")} · Drag agents or use Bulk Schedule
          </p>
        </CardHeader>
        <CardContent>
          {/* Agent pool */}
          <div className="mb-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Agents — drag to schedule</p>
            <div className="flex flex-wrap gap-2">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, agent)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium cursor-grab active:cursor-grabbing transition-all hover:shadow-sm",
                    agentColorMap.get(agent.id)
                  )}
                >
                  <GripVertical className="w-3 h-3 opacity-50" />
                  {agent.name}
                  {agent.extension && <span className="opacity-60">({agent.extension})</span>}
                </div>
              ))}
              {agents.length === 0 && (
                <p className="text-xs text-muted-foreground">No agents yet. Add agents from the Supervisor panel.</p>
              )}
            </div>
          </div>

          {/* Weekly calendar grid */}
          <div className="grid grid-cols-7 gap-1 min-h-[300px]">
            {days.map((day) => {
              const isToday = isSameDay(day, today);
              const daySchedule = getScheduleForDay(day);
              const isPast = day < today && !isToday;

              return (
                <div
                  key={day.toISOString()}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, day)}
                  className={cn(
                    "border rounded-lg p-2 min-h-[200px] transition-colors",
                    isToday && "border-primary/50 bg-primary/5",
                    isPast && "opacity-60",
                    draggedAgent && "border-dashed border-primary/30 bg-primary/5"
                  )}
                >
                  <div className={cn("text-center mb-2 pb-1 border-b border-border/50")}>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {format(day, "EEE")}
                    </div>
                    <div className={cn("text-sm font-semibold", isToday && "text-primary")}>
                      {format(day, "d")}
                    </div>
                  </div>

                  <div className="space-y-1">
                    {daySchedule.map((entry) => (
                      <div
                        key={entry.id}
                        className={cn(
                          "group relative rounded px-1.5 py-1 border text-[10px] leading-tight",
                          agentColorMap.get(entry.agent_id) || "bg-secondary border-border"
                        )}
                      >
                        <div className="font-medium truncate">{entry.agent?.name || "?"}</div>

                        {editingShift === entry.id ? (
                          <div className="flex items-center gap-0.5 mt-0.5">
                            <Input
                              type="time"
                              value={editStart}
                              onChange={(e) => setEditStart(e.target.value)}
                              className="h-5 text-[10px] px-1 w-[60px] bg-background"
                            />
                            <span className="text-[8px]">–</span>
                            <Input
                              type="time"
                              value={editEnd}
                              onChange={(e) => setEditEnd(e.target.value)}
                              className="h-5 text-[10px] px-1 w-[60px] bg-background"
                            />
                            <button
                              onClick={() => saveEditedTime(entry)}
                              className="flex items-center justify-center w-4 h-4 rounded bg-primary text-primary-foreground ml-0.5"
                            >
                              <Check className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={() => setEditingShift(null)}
                              className="flex items-center justify-center w-4 h-4 rounded bg-muted text-muted-foreground"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ) : (
                          <div
                            className="opacity-70 cursor-pointer hover:opacity-100 flex items-center gap-0.5"
                            onClick={() => startEditing(entry)}
                            title="Click to edit time"
                          >
                            <Clock className="w-2.5 h-2.5" />
                            {entry.start_time}–{entry.end_time}
                            <Pencil className="w-2 h-2 opacity-0 group-hover:opacity-60 ml-0.5" />
                          </div>
                        )}

                        {entry.notes && (
                          <div className="opacity-60 truncate italic mt-0.5" title={entry.notes}>
                            {entry.notes}
                          </div>
                        )}
                        {editingShift !== entry.id && (
                          <div className="absolute -top-1 -right-1 hidden group-hover:flex items-center gap-0.5">
                            <button
                              onClick={() => openReassignDialog(entry)}
                              className="flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground"
                              title="Reassign shift"
                            >
                              <RefreshCw className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={() => handleRemoveShift(entry.id)}
                              className="flex items-center justify-center w-4 h-4 rounded-full bg-destructive text-destructive-foreground"
                              title="Remove shift"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}

                    {daySchedule.length === 0 && (
                      <div className="text-[10px] text-muted-foreground text-center pt-4 opacity-50">
                        Drop here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span>📌 Selected slot: <Badge variant="outline" className="text-[10px] py-0">{selectedSlot}</Badge></span>
            <span>🔄 Hover a shift to reassign or remove</span>
            <span>✏️ Click time to edit inline</span>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Schedule Dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Bulk Schedule Shifts
            </DialogTitle>
            <DialogDescription>
              Select agents and days to schedule the same shift for all at once.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Time slot */}
            <div className="space-y-2">
              <Label>Shift Time</Label>
              <Select value={bulkSlot} onValueChange={setBulkSlot}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_SLOTS.map((slot) => (
                    <SelectItem key={`${slot.start}-${slot.end}`} value={`${slot.start} – ${slot.end}`}>
                      {slot.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Agent selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Agents</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => {
                    if (bulkAgents.size === agents.length) {
                      setBulkAgents(new Set());
                    } else {
                      setBulkAgents(new Set(agents.map((a) => a.id)));
                    }
                  }}
                >
                  {bulkAgents.size === agents.length ? "Deselect All" : "Select All"}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {agents.map((agent) => (
                  <label
                    key={agent.id}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors",
                      bulkAgents.has(agent.id)
                        ? "border-primary/50 bg-primary/5"
                        : "border-border hover:bg-muted/30"
                    )}
                  >
                    <Checkbox
                      checked={bulkAgents.has(agent.id)}
                      onCheckedChange={() => toggleBulkAgent(agent.id)}
                    />
                    <span className="text-sm">{agent.name}</span>
                    {agent.extension && (
                      <span className="text-[10px] text-muted-foreground">Ext {agent.extension}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            {/* Day selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Days ({format(weekStart, "MMM d")} – {format(weekEnd, "MMM d")})</Label>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => setBulkDays(new Set([0, 1, 2, 3, 4]))}
                  >
                    Weekdays
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => {
                      if (bulkDays.size === 7) setBulkDays(new Set());
                      else setBulkDays(new Set([0, 1, 2, 3, 4, 5, 6]));
                    }}
                  >
                    All
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                {DAY_LABELS.map((label, idx) => (
                  <button
                    key={idx}
                    onClick={() => toggleBulkDay(idx)}
                    className={cn(
                      "flex-1 py-2 rounded-md border text-xs font-medium transition-colors",
                      bulkDays.has(idx)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-muted/30"
                    )}
                  >
                    <div>{label}</div>
                    <div className="text-[10px] opacity-70">{format(days[idx], "d")}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Summary */}
            {bulkAgents.size > 0 && bulkDays.size > 0 && (
              <div className="rounded-md bg-muted/30 border border-border/50 p-2 text-xs text-muted-foreground">
                Will create up to <strong className="text-foreground">{bulkAgents.size * bulkDays.size}</strong> shifts
                for <strong className="text-foreground">{bulkAgents.size}</strong> agent(s)
                across <strong className="text-foreground">{bulkDays.size}</strong> day(s).
                Conflicts are automatically skipped.
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button
              onClick={handleBulkSchedule}
              disabled={bulkLoading || bulkAgents.size === 0 || bulkDays.size === 0}
            >
              {bulkLoading ? "Scheduling..." : `Schedule ${bulkAgents.size * bulkDays.size} Shift(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reassign Shift Dialog */}
      <Dialog open={reassignDialog.open} onOpenChange={(open) => setReassignDialog({ open, entry: open ? reassignDialog.entry : null })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-primary" />
              Reassign Shift
            </DialogTitle>
            <DialogDescription>
              {reassignDialog.entry && (
                <>
                  Reassign <strong>{reassignDialog.entry.agent?.name}</strong>'s shift on{" "}
                  <strong>{reassignDialog.entry.shift_date}</strong> ({reassignDialog.entry.start_time}–{reassignDialog.entry.end_time})
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Assign to Agent</Label>
              <Select value={reassignAgentId} onValueChange={setReassignAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select replacement agent" />
                </SelectTrigger>
                <SelectContent>
                  {availableAgentsForReassign.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name} {agent.extension ? `(Ext ${agent.extension})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Reason for Change</Label>
              <Select value={reassignReasonPreset} onValueChange={setReassignReasonPreset}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {REASSIGN_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {reason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {reassignReasonPreset === "Other" && (
              <div className="space-y-2">
                <Label>Custom Reason</Label>
                <Textarea
                  placeholder="Describe the reason for this shift change..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  rows={3}
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReassignDialog({ open: false, entry: null })}>
              Cancel
            </Button>
            <Button
              onClick={handleReassign}
              disabled={!reassignAgentId || (!reassignReasonPreset || (reassignReasonPreset === "Other" && !customReason.trim())) || reassignShift.isPending}
            >
              {reassignShift.isPending ? "Reassigning..." : "Reassign & Notify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
