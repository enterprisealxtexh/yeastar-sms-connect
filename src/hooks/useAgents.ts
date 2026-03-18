import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { agentsApi, clockApi, apiCall } from "@/lib/api-client";

export interface Agent {
  id: string;
  name: string;
  pin: string;
  email: string | null;
  phone: string | null;
  extension: string | null;
  telegram_chat_id: string | null;
  notification_channel: "telegram" | "email" | "both";
  is_active: boolean;
  created_at: string;
}

export interface AgentShift {
  id: string;
  agent_id: string;
  clock_in: string;
  clock_out: string | null;
  status: string;
  created_at: string;
  agent?: Agent;
}

export interface ShiftScheduleEntry {
  id: string;
  agent_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  agent?: Agent;
}

const generatePin = () => String(Math.floor(1000 + Math.random() * 9000));

export const useAgents = () =>
  useQuery({
    queryKey: ["agents"],
    queryFn: () => agentsApi.list() as Promise<Agent[]>,
  });

export const useAllAgents = () =>
  useQuery({
    queryKey: ["agents-all"],
    queryFn: () => agentsApi.listAll() as Promise<Agent[]>,
  });

export const useActiveShifts = () =>
  useQuery({
    queryKey: ["active-shifts"],
    queryFn: () => clockApi.active() as Promise<AgentShift[]>,
    refetchInterval: 30000,
  });

export const useTodayShifts = () =>
  useQuery({
    queryKey: ["today-shifts"],
    queryFn: () => clockApi.today() as Promise<AgentShift[]>,
    refetchInterval: 30000,
  });

export const useShiftSchedule = (date?: string) => {
  const targetDate = date || new Date().toISOString().split("T")[0];
  return useQuery({
    queryKey: ["shift-schedule", targetDate],
    queryFn: () => clockApi.schedule(targetDate) as Promise<ShiftScheduleEntry[]>,
  });
};

export const useWeekSchedule = (weekStart: string, weekEnd: string) =>
  useQuery({
    queryKey: ["week-schedule", weekStart, weekEnd],
    queryFn: () => clockApi.weekSchedule(weekStart, weekEnd) as Promise<ShiftScheduleEntry[]>,
  });

export const useClockIn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pin: string) => {
      const result = await clockApi.clockIn(pin);
      if (!result.success) throw new Error(result.error || "Clock in/out failed");
      return result.data as { action: "clock_in" | "clock_out"; user: { name: string; email: string | null } };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["active-shifts"] });
      queryClient.invalidateQueries({ queryKey: ["today-shifts"] });
      if (result.action === "clock_in") toast.success(`${result.user.name} clocked in`);
      else toast.success(`${result.user.name} clocked out`);
    },
    onError: (err: Error) => toast.error(err.message || "Clock in/out failed"),
  });
};

export const useCreateAgent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (agent: {
      name: string;
      email?: string;
      phone?: string;
      extension?: string;
      telegram_chat_id?: string;
      notification_channel?: "telegram" | "email" | "both";
    }) => {
      const pin = generatePin();
      const result = await agentsApi.create({ ...agent, pin });
      if (!result.success) throw new Error(result.error || "Failed to create agent");
      return result.data as Agent;
    },
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["agents-all"] });
      toast.success(`Agent created! PIN: ${agent.pin}`, { duration: 10000 });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create agent"),
  });
};

export const useUpdateAgent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [k: string]: unknown }) => {
      const result = await agentsApi.update(id, updates);
      if (!result.success) throw new Error(result.error || "Failed to update agent");
      return result.data as Agent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["agents-all"] });
      toast.success("Agent updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update agent"),
  });
};

export const timesOverlap = (start1: string, end1: string, start2: string, end2: string): boolean => {
  const toMinutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const s1 = toMinutes(start1), e1 = toMinutes(end1), s2 = toMinutes(start2), e2 = toMinutes(end2);
  const ranges1 = e1 <= s1 ? [[s1, e1 + 1440]] : [[s1, e1]];
  const ranges2 = e2 <= s2 ? [[s2, e2 + 1440]] : [[s2, e2]];
  return ranges1.some(([a, b]) => ranges2.some(([c, d]) => a < d && c < b));
};

export const useCreateSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entry: { agent_id: string; shift_date: string; start_time: string; end_time: string; notes?: string }) => {
      const result = await clockApi.saveSchedule(entry);
      if (!result.success) throw new Error(result.error || "Failed to schedule shift");
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["week-schedule"] });
      toast.success("Shift scheduled");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to schedule shift"),
  });
};

export const useDeleteSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await clockApi.deleteSchedule(id);
      if (!result.success) throw new Error(result.error || "Failed to remove shift");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["week-schedule"] });
      toast.success("Shift removed");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to remove shift"),
  });
};

export const useReassignShift = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      shiftId, newAgentId, reason, originalAgent, newAgent, shiftDate, startTime, endTime,
    }: {
      shiftId: string; newAgentId: string; reason: string;
      originalAgent: Agent; newAgent: Agent;
      shiftDate: string; startTime: string; endTime: string;
    }) => {
      await apiCall(`/api/shift-schedule/${shiftId}/reassign`, {
        method: "POST",
        body: JSON.stringify({ agent_id: newAgentId, newAgentId, reason }),
      });
      await clockApi.notifyShiftChange({
        action: "reassign",
        original_agent_id: originalAgent.id,
        new_agent_id: newAgent.id,
        original_agent_name: originalAgent.name,
        new_agent_name: newAgent.name,
        shift_date: shiftDate,
        shift_time: `${startTime}-${endTime}`,
        reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["week-schedule"] });
      toast.success("Shift reassigned");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to reassign shift"),
  });
};

export const useAgentDailyStats = () => {
  const today = new Date().toISOString().split("T")[0];
  return useQuery({
    queryKey: ["agent-daily-stats", today],
    queryFn: async () => {
      const result = await apiCall(`/api/agent-daily-stats?date=${today}`);
      if (!result.success) throw new Error(result.error || "Failed to fetch stats");
      return result.data;
    },
    refetchInterval: 30000,
  });
};
