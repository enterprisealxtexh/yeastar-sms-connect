import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { callsApi } from "@/lib/api-client";

export interface MissedCallRecord {
  id: string;
  caller_number: string;
  caller_name: string | null;
  callee_number: string;
  extension: string | null;
  sim_port: number | null;
  start_time: string;
  ring_duration: number;
  callback_attempted: boolean;
  callback_notes: string | null;
}

export const useMissedCallReport = () => {
  return useQuery({
    queryKey: ["missed-call-report"],
    queryFn: async (): Promise<MissedCallRecord[]> => {
      const data = await callsApi.records({ status: 'missed', limit: 200 });
      return (data?.data || []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        caller_number: String(r.caller_number || ""),
        caller_name: r.caller_name ? String(r.caller_name) : null,
        callee_number: String(r.callee_number || ""),
        extension: r.extension ? String(r.extension) : null,
        sim_port: r.sim_port != null ? Number(r.sim_port) : null,
        start_time: String(r.start_time || ""),
        ring_duration: Number(r.ring_duration || 0),
        callback_attempted: Boolean(r.is_returned || r.callback_attempted),
        callback_notes: r.notes ? String(r.notes) : null,
      }));
    },
    refetchInterval: 30000,
  });
};

export const useMarkCallbackAttempted = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, callback_notes }: { id: string; callback_notes?: string }) => {
      const result = await callsApi.markCallback(id, callback_notes);
      if (!result.success) throw new Error(result.error || "Failed to update record");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["missed-call-report"] });
      toast.success("Marked as callback attempted");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update record");
    },
  });
};

export const useSendMissedCallSms = () => {
  return useMutation({
    mutationFn: async ({ caller_number }: { caller_number: string }) => {
      const result = await callsApi.sendMissedCallNotify(caller_number);
      if (!result.success) throw new Error(result.error || 'Failed to send notification');
    },
    onSuccess: () => {
      toast.success('Admin notified by email');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to send notification');
    },
  });
};
