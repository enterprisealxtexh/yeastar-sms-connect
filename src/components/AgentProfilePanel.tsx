import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAgents, useUpdateAgent, type Agent } from "@/hooks/useAgents";
import { useQuery } from "@tanstack/react-query";
import { UserCog, Eye, EyeOff, KeyRound, Save, Send, Phone, MessageSquare, PhoneIncoming, PhoneOutgoing, Bell, Mail } from "lucide-react";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

const useSimPorts = () =>
  useQuery({
    queryKey: ["sim-port-config"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/sim-ports`);
      const json = await res.json();
      return (json.data || []) as { id: string; port_number: number; label: string | null; extension: string | null }[];
    },
  });

const useAgentExtensionStats = (extension: string | null) =>
  useQuery({
    queryKey: ["agent-ext-stats", extension],
    enabled: !!extension,
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const since = thirtyDaysAgo.toISOString();

      const [callsJson, portsJson, smsJson] = await Promise.all([
        fetch(`${API_URL}/api/call-records?extension=${encodeURIComponent(extension!)}&start_time_from=${encodeURIComponent(since)}&limit=10000`).then(r => r.json()),
        fetch(`${API_URL}/api/sim-ports`).then(r => r.json()),
        fetch(`${API_URL}/api/sms-messages?limit=10000&since=${encodeURIComponent(since)}`).then(r => r.json()),
      ]);

      const calls = (callsJson.data || []) as { status: string; direction: string; talk_duration: number }[];
      const totalCalls = calls.length;
      const answered = calls.filter((c) => c.status === "answered").length;
      const missed = calls.filter((c) => c.status === "missed").length;
      const inbound = calls.filter((c) => c.direction === "inbound").length;
      const outbound = calls.filter((c) => c.direction === "outbound").length;
      const talkTime = calls.reduce((sum, c) => sum + (c.talk_duration || 0), 0);

      const portNumbers = (portsJson.data || [])
        .filter((p: { extension: string | null }) => p.extension === extension)
        .map((p: { port_number: number }) => p.port_number);

      const smsMessages = (smsJson.data || []) as { sim_port: number }[];
      const smsCount = portNumbers.length > 0
        ? smsMessages.filter((s) => portNumbers.includes(s.sim_port)).length
        : 0;

      return { totalCalls, answered, missed, inbound, outbound, talkTime, smsCount };
    },
  });

export const AgentProfilePanel = () => {
  const { data: agents = [] } = useAgents();
  const { data: simPorts = [] } = useSimPorts();
  const updateAgent = useUpdateAgent();
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showPin, setShowPin] = useState(false);

  const [form, setForm] = useState({
    pin: "",
    email: "",
    phone: "",
    extension: "",
    telegram_chat_id: "",
    notification_channel: "telegram" as "telegram" | "email" | "both",
  });

  const { data: extStats } = useAgentExtensionStats(
    dialogOpen ? form.extension || null : null
  );

  // Collect all known extensions: from SIM ports + any custom ones already on agents
  const availableExtensions = useMemo(() => {
    const extSet = new Set<string>();
    simPorts.forEach((p) => {
      if (p.extension) extSet.add(p.extension);
    });
    agents.forEach((a) => {
      if (a.extension) extSet.add(a.extension);
    });
    return Array.from(extSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [simPorts, agents]);

  // Map extension to sim port label
  const extToLabel = useMemo(() => {
    const map = new Map<string, string>();
    simPorts.forEach((p) => {
      if (p.extension) {
        map.set(p.extension, p.label || `Port ${p.port_number}`);
      }
    });
    return map;
  }, [simPorts]);

  // Check which extensions are already assigned to other agents
  const assignedExts = useMemo(() => {
    const map = new Map<string, string>();
    agents.forEach((a) => {
      if (a.extension && a.id !== selectedAgent?.id) {
        map.set(a.extension, a.name);
      }
    });
    return map;
  }, [agents, selectedAgent]);

  const openProfile = (agent: Agent) => {
    setSelectedAgent(agent);
    setForm({
      pin: "",
      email: agent.email || "",
      phone: agent.phone || "",
      extension: agent.extension || "",
      telegram_chat_id: agent.telegram_chat_id || "",
      notification_channel: agent.notification_channel || "telegram",
    });
    setShowPin(false);
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!selectedAgent) return;
    const updates: Record<string, string | undefined> = {};
    if (form.pin && form.pin.length >= 4) updates.pin = form.pin;
    if (form.email !== (selectedAgent.email || "")) updates.email = form.email || undefined;
    if (form.phone !== (selectedAgent.phone || "")) updates.phone = form.phone || undefined;
    if (form.extension !== (selectedAgent.extension || "")) updates.extension = form.extension || undefined;
    if (form.telegram_chat_id !== (selectedAgent.telegram_chat_id || "")) updates.telegram_chat_id = form.telegram_chat_id || undefined;
    if (form.notification_channel !== (selectedAgent.notification_channel || "telegram")) updates.notification_channel = form.notification_channel;

    if (Object.keys(updates).length === 0) {
      toast.info("No changes to save");
      return;
    }

    updateAgent.mutate(
      { id: selectedAgent.id, ...updates },
      { onSuccess: () => setDialogOpen(false) }
    );
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <UserCog className="w-4 h-4" />
          Agent Profiles
        </CardTitle>
        <CardDescription>Manage PINs, PBX extensions, and contact info</CardDescription>
      </CardHeader>
      <CardContent>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents configured</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => openProfile(agent)}
                className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  {agent.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{agent.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    {agent.extension ? (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                        <Phone className="w-2.5 h-2.5 mr-0.5" />
                        Ext {agent.extension}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground/60">No ext</span>
                    )}
                    {agent.telegram_chat_id && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">📱 TG</Badge>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Profile — {selectedAgent?.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Extension Stats Banner */}
              {form.extension && extStats && (
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Extension {form.extension} — Last 30 Days
                  </p>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <div className="text-lg font-bold">{extStats.totalCalls}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                        <Phone className="w-2.5 h-2.5" /> Calls
                      </div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-green-500">{extStats.answered}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                        <PhoneIncoming className="w-2.5 h-2.5" /> Answered
                      </div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-destructive">{extStats.missed}</div>
                      <div className="text-[10px] text-muted-foreground">Missed</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold">{extStats.smsCount}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                        <MessageSquare className="w-2.5 h-2.5" /> SMS
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
                    <span>
                      <PhoneIncoming className="w-2.5 h-2.5 inline mr-0.5" />
                      {extStats.inbound} in / <PhoneOutgoing className="w-2.5 h-2.5 inline mr-0.5" />{extStats.outbound} out
                    </span>
                    <span>Talk: {formatDuration(extStats.talkTime)}</span>
                  </div>
                </div>
              )}

              <div>
                <Label className="flex items-center gap-1"><KeyRound className="w-3 h-3" /> Change PIN</Label>
                <div className="flex gap-2">
                  <Input
                    type={showPin ? "text" : "password"}
                    placeholder="Enter new 4-6 digit PIN"
                    value={form.pin}
                    onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                    maxLength={6}
                    className="font-mono"
                  />
                  <Button variant="ghost" size="icon" onClick={() => setShowPin(!showPin)}>
                    {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Leave blank to keep current PIN</p>
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label className="flex items-center gap-1"><Phone className="w-3 h-3" /> PBX Extension</Label>
                <Select
                  value={form.extension || "__none__"}
                  onValueChange={(val) => setForm({ ...form, extension: val === "__none__" ? "" : val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select PBX extension" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No extension</SelectItem>
                    {availableExtensions.map((ext) => {
                      const label = extToLabel.get(ext);
                      const assignedTo = assignedExts.get(ext);
                      return (
                        <SelectItem key={ext} value={ext} disabled={!!assignedTo}>
                          Ext {ext}
                          {label ? ` (${label})` : ""}
                          {assignedTo ? ` — assigned to ${assignedTo}` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Links this agent to a PBX user for call/SMS tracking</p>
              </div>
              <div>
                <Label className="flex items-center gap-1"><Send className="w-3 h-3" /> Telegram Chat ID</Label>
                <Input
                  value={form.telegram_chat_id}
                  onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })}
                  placeholder="Agent's personal Telegram chat ID"
                />
                <p className="text-xs text-muted-foreground mt-1">Agent will receive shift & performance notifications on Telegram</p>
              </div>
              <div>
                <Label className="flex items-center gap-1"><Bell className="w-3 h-3" /> Notification Preference</Label>
                <RadioGroup
                  value={form.notification_channel}
                  onValueChange={(val) => setForm({ ...form, notification_channel: val as "telegram" | "email" | "both" })}
                  className="flex gap-4 mt-2"
                >
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="telegram" id={`notif-tg-${selectedAgent?.id}`} />
                    <Label htmlFor={`notif-tg-${selectedAgent?.id}`} className="text-sm font-normal flex items-center gap-1 cursor-pointer">
                      <Send className="w-3 h-3" /> Telegram
                    </Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="email" id={`notif-email-${selectedAgent?.id}`} />
                    <Label htmlFor={`notif-email-${selectedAgent?.id}`} className="text-sm font-normal flex items-center gap-1 cursor-pointer">
                      <Mail className="w-3 h-3" /> Email
                    </Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="both" id={`notif-both-${selectedAgent?.id}`} />
                    <Label htmlFor={`notif-both-${selectedAgent?.id}`} className="text-sm font-normal flex items-center gap-1 cursor-pointer">
                      <Bell className="w-3 h-3" /> Both
                    </Label>
                  </div>
                </RadioGroup>
                <p className="text-xs text-muted-foreground mt-1">
                  {form.notification_channel === "telegram" && "Notifications via Telegram only (email used as fallback if no chat ID)"}
                  {form.notification_channel === "email" && "Notifications via email only"}
                  {form.notification_channel === "both" && "Notifications via both Telegram and email"}
                </p>
              </div>
              <Button onClick={handleSave} disabled={updateAgent.isPending} className="w-full">
                <Save className="w-4 h-4 mr-2" /> Save Changes
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};
