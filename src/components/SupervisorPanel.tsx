import { useState } from "react";
import { WeeklyShiftPlanner } from "@/components/WeeklyShiftPlanner";
import { ShiftSwapPanel } from "@/components/ShiftSwapPanel";
import { AgentShiftRating } from "@/components/AgentShiftRating";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  useAgents,
  useAgentDailyStats,
  useActiveShifts,
  useTodayShifts,
  useShiftSchedule,
  useCreateAgent,
  useCreateSchedule,
} from "@/hooks/useAgents";
import { Users, UserPlus, CalendarPlus, Clock, PhoneCall, PhoneMissed, PhoneForwarded, Timer } from "lucide-react";
import { format } from "date-fns";

const formatDuration = (seconds: number) => {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

export const SupervisorPanel = () => {
  const { data: agents = [] } = useAgents();
  const { data: dailyStats = [], isLoading: statsLoading } = useAgentDailyStats();
  const { data: activeShifts = [] } = useActiveShifts();
  const { data: todayShifts = [] } = useTodayShifts();
  const { data: schedule = [] } = useShiftSchedule();
  const createAgent = useCreateAgent();
  const createSchedule = useCreateSchedule();

  const [newAgent, setNewAgent] = useState({ name: "", email: "", phone: "", extension: "", telegram_chat_id: "" });
  const [newSchedule, setNewSchedule] = useState({ agent_id: "", shift_date: "", start_time: "08:00", end_time: "17:00", notes: "" });
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

  const handleCreateAgent = () => {
    if (!newAgent.name) return;
    createAgent.mutate(
      { name: newAgent.name, email: newAgent.email || undefined, phone: newAgent.phone || undefined, extension: newAgent.extension || undefined, telegram_chat_id: newAgent.telegram_chat_id || undefined },
      { onSuccess: () => { setNewAgent({ name: "", email: "", phone: "", extension: "", telegram_chat_id: "" }); setAgentDialogOpen(false); } }
    );
  };

  const handleCreateSchedule = () => {
    if (!newSchedule.agent_id || !newSchedule.shift_date) return;
    createSchedule.mutate(newSchedule, {
      onSuccess: () => { setNewSchedule({ agent_id: "", shift_date: "", start_time: "08:00", end_time: "17:00", notes: "" }); setScheduleDialogOpen(false); }
    });
  };

  const activeAgentIds = new Set(activeShifts.map((s) => s.agent_id));
  const agentsNotOnShift = agents.filter((a) => !activeAgentIds.has(a.id));

  // Scheduled today but not clocked in
  const scheduledTodayIds = new Set(schedule.map((s) => s.agent_id));
  const todayClockInIds = new Set(todayShifts.map((s) => s.agent_id));
  const absentAgents = agents.filter((a) => scheduledTodayIds.has(a.id) && !todayClockInIds.has(a.id));

  return (
    <div className="space-y-6">
      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <Dialog open={agentDialogOpen} onOpenChange={setAgentDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm"><UserPlus className="w-4 h-4 mr-2" /> Add Agent</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add New Agent</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={newAgent.name} onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} /></div>
              <div><Label>Email</Label><Input type="email" value={newAgent.email} onChange={(e) => setNewAgent({ ...newAgent, email: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={newAgent.phone} onChange={(e) => setNewAgent({ ...newAgent, phone: e.target.value })} /></div>
              <div><Label>Extension</Label><Input value={newAgent.extension} onChange={(e) => setNewAgent({ ...newAgent, extension: e.target.value })} placeholder="e.g. 8001" /></div>
              <div><Label>Telegram Chat ID</Label><Input value={newAgent.telegram_chat_id} onChange={(e) => setNewAgent({ ...newAgent, telegram_chat_id: e.target.value })} placeholder="For personal notifications" /></div>
              <p className="text-xs text-muted-foreground">PIN will be auto-generated and shown after creation</p>
              <Button onClick={handleCreateAgent} disabled={createAgent.isPending || !newAgent.name}>Create Agent</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm"><CalendarPlus className="w-4 h-4 mr-2" /> Schedule Shift</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Schedule a Shift</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Agent *</Label>
                <Select value={newSchedule.agent_id} onValueChange={(v) => setNewSchedule({ ...newSchedule, agent_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Date *</Label><Input type="date" value={newSchedule.shift_date} onChange={(e) => setNewSchedule({ ...newSchedule, shift_date: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Start</Label><Input type="time" value={newSchedule.start_time} onChange={(e) => setNewSchedule({ ...newSchedule, start_time: e.target.value })} /></div>
                <div><Label>End</Label><Input type="time" value={newSchedule.end_time} onChange={(e) => setNewSchedule({ ...newSchedule, end_time: e.target.value })} /></div>
              </div>
              <div><Label>Notes</Label><Input value={newSchedule.notes} onChange={(e) => setNewSchedule({ ...newSchedule, notes: e.target.value })} /></div>
              <Button onClick={handleCreateSchedule} disabled={createSchedule.isPending || !newSchedule.agent_id || !newSchedule.shift_date}>Schedule</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Live Status Board */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-chart-2 animate-pulse" />
              On Shift
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-chart-2">{activeShifts.length}</div>
            <div className="mt-2 space-y-1">
              {activeShifts.map((s) => (
                <div key={s.id} className="text-xs text-muted-foreground flex justify-between">
                  <span>{s.agent?.name}</span>
                  <span>since {format(new Date(s.clock_in), "HH:mm")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-muted-foreground" />
              Off Shift
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-muted-foreground">{agentsNotOnShift.length}</div>
            <div className="mt-2 space-y-1">
              {agentsNotOnShift.slice(0, 5).map((a) => (
                <div key={a.id} className="text-xs text-muted-foreground">{a.name}</div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className={absentAgents.length > 0 ? "border-destructive/50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-destructive" />
              Absent (Scheduled)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">{absentAgents.length}</div>
            <div className="mt-2 space-y-1">
              {absentAgents.map((a) => (
                <div key={a.id} className="text-xs text-destructive">{a.name}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daily Performance Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users className="w-4 h-4" />
            Agent Daily Performance
          </CardTitle>
          <CardDescription>Today's call statistics per agent</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Shift Time</TableHead>
                <TableHead className="text-center"><PhoneCall className="w-3 h-3 inline mr-1" />Total</TableHead>
                <TableHead className="text-center">Inbound</TableHead>
                <TableHead className="text-center">Outbound</TableHead>
                <TableHead className="text-center text-chart-2">Answered</TableHead>
                <TableHead className="text-center text-destructive"><PhoneMissed className="w-3 h-3 inline mr-1" />Missed</TableHead>
                <TableHead className="text-center"><PhoneForwarded className="w-3 h-3 inline mr-1" />Called Back</TableHead>
                <TableHead className="text-center"><Timer className="w-3 h-3 inline mr-1" />Talk Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statsLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : dailyStats.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No agents configured</TableCell></TableRow>
              ) : (
                dailyStats.map((stat) => (
                  <TableRow key={stat.agent.id}>
                    <TableCell className="font-medium">
                      <div>{stat.agent.name}</div>
                      {stat.agent.extension && <div className="text-xs text-muted-foreground">Ext {stat.agent.extension}</div>}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={stat.isOnShift ? "default" : "secondary"} className={stat.isOnShift ? "bg-chart-2 text-white" : ""}>
                        {stat.isOnShift ? "On Shift" : "Off"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {stat.shiftMinutes > 0 ? `${Math.floor(stat.shiftMinutes / 60)}h ${stat.shiftMinutes % 60}m` : "—"}
                    </TableCell>
                    <TableCell className="text-center font-semibold">{stat.totalCalls}</TableCell>
                    <TableCell className="text-center">{stat.inbound}</TableCell>
                    <TableCell className="text-center">{stat.outbound}</TableCell>
                    <TableCell className="text-center text-chart-2">{stat.answered}</TableCell>
                    <TableCell className="text-center text-destructive">{stat.missed}</TableCell>
                    <TableCell className="text-center">
                      {stat.calledBack}
                      {stat.missed > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">
                          ({Math.round((stat.calledBack / stat.missed) * 100)}%)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{formatDuration(stat.totalTalkTime)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Today's Shift Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Today's Shift Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Clock In</TableHead>
                <TableHead>Clock Out</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {todayShifts.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No shifts today</TableCell></TableRow>
              ) : (
                todayShifts.map((shift) => {
                  const clockIn = new Date(shift.clock_in);
                  const clockOut = shift.clock_out ? new Date(shift.clock_out) : null;
                  const durationMin = clockOut
                    ? Math.round((clockOut.getTime() - clockIn.getTime()) / 60000)
                    : Math.round((Date.now() - clockIn.getTime()) / 60000);
                  return (
                    <TableRow key={shift.id}>
                      <TableCell className="font-medium">{shift.agent?.name || "Unknown"}</TableCell>
                      <TableCell>{format(clockIn, "HH:mm")}</TableCell>
                      <TableCell>{clockOut ? format(clockOut, "HH:mm") : "—"}</TableCell>
                      <TableCell>{`${Math.floor(durationMin / 60)}h ${durationMin % 60}m`}</TableCell>
                      <TableCell>
                        <Badge variant={shift.status === "active" ? "default" : "secondary"}>
                          {shift.status === "active" ? "Active" : "Completed"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Scheduled Shifts */}
      {schedule.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Today's Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedule.map((s) => {
                  const isClockedIn = todayClockInIds.has(s.agent_id);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.agent?.name || "Unknown"}</TableCell>
                      <TableCell>{s.start_time}</TableCell>
                      <TableCell>{s.end_time}</TableCell>
                      <TableCell>
                        <Badge variant={isClockedIn ? "default" : "destructive"}>
                          {isClockedIn ? "Present" : "Absent"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.notes || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Weekly Shift Planner */}
      <WeeklyShiftPlanner />

      {/* Agent Shift Ratings */}
      <AgentShiftRating />

      {/* Shift Swap Requests */}
      <ShiftSwapPanel />
    </div>
  );
};
