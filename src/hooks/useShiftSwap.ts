import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { clockApi } from "@/lib/api-client";
import type { Agent, ShiftScheduleEntry } from "@/hooks/useAgents";

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
    queryFn: async () => {
      const data = await clockApi.swapRequests();
      return (data as any) as ShiftSwapRequest[];
    },
    refetchInterval: 30000,
  });

export const usePendingSwapCount = () =>
  useQuery({
    queryKey: ["swap-requests-pending-count"],
    queryFn: async () => {
      const rows = await clockApi.swapRequests('pending') as ShiftSwapRequest[];
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
      await clockApi.createSwapRequest({
        requester_agent_id: requesterAgentId,
        requester_shift_id: requesterShiftId,
        target_agent_id: targetAgentId,
        target_shift_id: targetShiftId,
        reason,
      });

      await clockApi.notifyShiftChange({
        action: "swap_request",
        requester_name: requesterAgent.name,
        target_name: targetAgent.name,
        requester_shift_date: requesterShift.shift_date,
        requester_shift_time: `${requesterShift.start_time}-${requesterShift.end_time}`,
        target_shift_date: targetShift.shift_date,
        target_shift_time: `${targetShift.start_time}-${targetShift.end_time}`,
        reason,
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
      await clockApi.approveSwapRequest(request.id, { reviewedBy: 'supervisor', reviewNote });

      await clockApi.notifyShiftChange({
        action: "swap_approved",
        requester_name: request.requester_agent?.name,
        target_name: request.target_agent?.name,
        reason: request.reason,
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
      await clockApi.rejectSwapRequest(request.id, { reviewedBy: 'supervisor', reason: reviewNote || 'Rejected by supervisor' });

      await clockApi.notifyShiftChange({
        action: "swap_rejected",
        requester_name: request.requester_agent?.name,
        target_name: request.target_agent?.name,
        requester_agent_id: request.requester_agent_id,
        target_agent_id: request.target_agent_id,
        reason: reviewNote || request.reason || "Rejected by supervisor",
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
