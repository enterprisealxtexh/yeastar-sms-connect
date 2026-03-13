import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

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

const jsonFetch = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.success === false) {
    throw new Error(payload?.error || payload?.message || "Request failed");
  }
  return payload;
};

export const useAgents = () =>
  useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await jsonFetch(`${API_URL}/api/agents`)).data as Agent[],
  });

export const useAllAgents = () =>
  useQuery({
    queryKey: ["agents-all"],
    queryFn: async () => (await jsonFetch(`${API_URL}/api/agents?all=1`)).data as Agent[],
  });

export const useActiveShifts = () =>
  useQuery({
    queryKey: ["active-shifts"],
    queryFn: async () => (await jsonFetch(`${API_URL}/api/clock/active`)).data as AgentShift[],
    refetchInterval: 30000,
  });

export const useTodayShifts = () =>
  useQuery({
    queryKey: ["today-shifts"],
    queryFn: async () => (await jsonFetch(`${API_URL}/api/clock/today`)).data as AgentShift[],
    refetchInterval: 30000,
  });

export const useShiftSchedule = (date?: string) => {
  const targetDate = date || new Date().toISOString().split("T")[0];
  return useQuery({
    queryKey: ["shift-schedule", targetDate],
    queryFn: async () => {
      const data = (await jsonFetch(`${API_URL}/api/shift-schedule?date=${targetDate}`)).data as ShiftScheduleEntry[];
      return data;
    },
  });
};

export const useWeekSchedule = (weekStart: string, weekEnd: string) =>
  useQuery({
    queryKey: ["week-schedule", weekStart, weekEnd],
    queryFn: async () =>
      (await jsonFetch(`${API_URL}/api/shift-schedule?startDate=${weekStart}&endDate=${weekEnd}`)).data as ShiftScheduleEntry[],
  });

export const useClockIn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pin: string) => {
      const payload = await jsonFetch(`${API_URL}/api/clock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      return payload as { action: "clock_in" | "clock_out"; user: { name: string; email: string | null } };
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
      const payload = await jsonFetch(`${API_URL}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...agent, pin }),
      });
      return payload.data as Agent;
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
      const payload = await jsonFetch(`${API_URL}/api/agents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return payload.data as Agent;
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
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const s1 = toMinutes(start1);
  const e1 = toMinutes(end1);
  const s2 = toMinutes(start2);
  const e2 = toMinutes(end2);

  const isOvernight1 = e1 <= s1;
  const isOvernight2 = e2 <= s2;

  const ranges1 = isOvernight1 ? [[s1, e1 + 1440]] : [[s1, e1]];
  const ranges2 = isOvernight2 ? [[s2, e2 + 1440]] : [[s2, e2]];

  return ranges1.some(([a, b]) => ranges2.some(([c, d]) => a < d && c < b));
};

export const useCreateSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entry: { agent_id: string; shift_date: string; start_time: string; end_time: string; notes?: string }) => {
      const payload = await jsonFetch(`${API_URL}/api/shift-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      return payload.data ?? payload;
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
    mutationFn: async (id: string) => jsonFetch(`${API_URL}/api/shift-schedule/${id}`, { method: "DELETE" }),
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
      shiftId,
      newAgentId,
      reason,
      originalAgent,
      newAgent,
      shiftDate,
      startTime,
      endTime,
    }: {
      shiftId: string;
      newAgentId: string;
      reason: string;
      originalAgent: Agent;
      newAgent: Agent;
      shiftDate: string;
      startTime: string;
      endTime: string;
    }) => {
      await jsonFetch(`${API_URL}/api/shift-schedule/${shiftId}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: newAgentId, newAgentId, reason }),
      });

      await jsonFetch(`${API_URL}/api/notify/shift-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reassign",
          original_agent_id: originalAgent.id,
          new_agent_id: newAgent.id,
          original_agent_name: originalAgent.name,
          new_agent_name: newAgent.name,
          shift_date: shiftDate,
          shift_time: `${startTime}-${endTime}`,
          reason,
        }),
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
    queryFn: async () => (await jsonFetch(`${API_URL}/api/agent-daily-stats?date=${today}`)).data,
    refetchInterval: 30000,
  });
};
