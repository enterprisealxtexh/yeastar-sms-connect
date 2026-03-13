import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Agent, ShiftScheduleEntry } from "@/hooks/useAgents";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

const jsonFetch = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.success === false) {
    throw new Error(payload?.error || payload?.message || "Request failed");
  }
  return payload;
};

export interface ShiftSwapRequest {
  id: string;
  requester_agent_id: string;
  requester_shift_id: string;
  target_agent_id: string;
  target_shift_id: string;
  reason: string;
  status: string;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  requester_agent?: Agent;
  target_agent?: Agent;
  requester_shift?: ShiftScheduleEntry;
  target_shift?: ShiftScheduleEntry;
}

export const useSwapRequests = () =>
  useQuery({
    queryKey: ["swap-requests"],
    queryFn: async () => (await jsonFetch(`${API_URL}/api/shift-swap-requests`)).data as ShiftSwapRequest[],
    refetchInterval: 30000,
  });

export const usePendingSwapCount = () =>
  useQuery({
    queryKey: ["swap-requests-pending-count"],
    queryFn: async () => {
      const rows = (await jsonFetch(`${API_URL}/api/shift-swap-requests?status=pending`)).data as ShiftSwapRequest[];
      return rows.length;
    },
    refetchInterval: 30000,
  });

export const useCreateSwapRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requesterAgentId,
      requesterShiftId,
      targetAgentId,
      targetShiftId,
      reason,
      requesterAgent,
      targetAgent,
      requesterShift,
      targetShift,
    }: {
      requesterAgentId: string;
      requesterShiftId: string;
      targetAgentId: string;
      targetShiftId: string;
      reason: string;
      requesterAgent: Agent;
      targetAgent: Agent;
      requesterShift: ShiftScheduleEntry;
      targetShift: ShiftScheduleEntry;
    }) => {
      await jsonFetch(`${API_URL}/api/shift-swap-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requester_agent_id: requesterAgentId,
          requester_shift_id: requesterShiftId,
          target_agent_id: targetAgentId,
          target_shift_id: targetShiftId,
          reason,
        }),
      });

      await jsonFetch(`${API_URL}/api/notify/shift-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "swap_request",
          requester_name: requesterAgent.name,
          target_name: targetAgent.name,
          requester_shift_date: requesterShift.shift_date,
          requester_shift_time: `${requesterShift.start_time}-${requesterShift.end_time}`,
          target_shift_date: targetShift.shift_date,
          target_shift_time: `${targetShift.start_time}-${targetShift.end_time}`,
          reason,
        }),
      });

      return { requesterAgent, targetAgent };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      queryClient.invalidateQueries({ queryKey: ["swap-requests-pending-count"] });
      toast.success(`Swap request sent: ${result.requesterAgent.name} ↔ ${result.targetAgent.name}`);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create swap request"),
  });
};

export const useApproveSwapRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ request, reviewNote }: { request: ShiftSwapRequest; reviewNote?: string }) => {
      await jsonFetch(`${API_URL}/api/shift-swap-requests/${request.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewedBy: "supervisor", reviewNote }),
      });

      await jsonFetch(`${API_URL}/api/notify/shift-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "swap_approved",
          requester_name: request.requester_agent?.name,
          target_name: request.target_agent?.name,
          reason: request.reason,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      queryClient.invalidateQueries({ queryKey: ["swap-requests-pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["shift-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["week-schedule"] });
      toast.success("Swap approved and shifts updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to approve swap"),
  });
};

export const useRejectSwapRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ request, reviewNote }: { request: ShiftSwapRequest; reviewNote?: string }) => {
      await jsonFetch(`${API_URL}/api/shift-swap-requests/${request.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewedBy: "supervisor", reason: reviewNote || "Rejected by supervisor" }),
      });

      await jsonFetch(`${API_URL}/api/notify/shift-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "swap_rejected",
          requester_name: request.requester_agent?.name,
          target_name: request.target_agent?.name,
          requester_agent_id: request.requester_agent_id,
          target_agent_id: request.target_agent_id,
          reason: reviewNote || request.reason || "Rejected by supervisor",
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      queryClient.invalidateQueries({ queryKey: ["swap-requests-pending-count"] });
      toast.success("Swap request rejected");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to reject swap"),
  });
};
