import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

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
      const response = await fetch(`${API_URL}/api/call-records?status=missed&limit=200`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to fetch missed calls");
      }
      return (data.data || []).map((r: Record<string, unknown>) => ({
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
      const response = await fetch(`${API_URL}/api/call-records/${id}/callback`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_attempted: true, callback_notes: callback_notes || null }),
      });
      if (response.status === 404) return;
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to update record");
      }
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

export const useSendMissedCallEmail = () => {
  return useMutation({
    mutationFn: async (_params: { call_id: string; to_email: string }) => {
      throw new Error("Email sending is not available in local mode");
    },
    onSuccess: () => {
      toast.success("Missed call notification sent");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to send email");
    },
  });
};
