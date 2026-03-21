import { useQuery } from "@tanstack/react-query";
import { callsApi } from "@/lib/api-client";

export interface CallRecord {
  id: string;
  external_id: string | null;
  caller_number: string;
  callee_number: string;
  caller_extension_username: string | null;
  callee_extension_username: string | null;
  direction: "inbound" | "outbound" | "internal";
  status: "answered" | "missed" | "busy" | "failed";
  sim_port: number | null;
  extension: string | null;
  start_time: string;
  answer_time: string | null;
  end_time: string | null;
  ring_duration: number;
  talk_duration: number;
  hold_duration: number;
  total_duration: number;
  recording_url: string | null;
  transfer_to: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const useCallRecords = (page = 1, pageSize = 100, extension?: string, direction?: string, status?: string, search?: string, enabled = true) => {
  return useQuery({
    queryKey: ['call-records', page, pageSize, extension, direction, status, search],
    enabled,
    queryFn: () => {
      const params: any = { page, pageSize, extension, direction, status };
      if (search && search.trim()) {
        params.search = search.trim();
      }
      return callsApi.records(params);
    },
    refetchInterval: 5000,
    staleTime: 1000,
    refetchOnMount: true,
    retry: 2,
  });
};

export const useCallStats = (extension?: string, enabled = true) => {
  return useQuery({
    queryKey: ['call-stats', extension ?? null],
    enabled,
    queryFn: async () => {
      const response = await callsApi.stats(extension);
      const data = response?.data || response;
      return data || { totalCalls: 0, answered: 0, missed: 0, totalTalkDuration: 0, totalRingDuration: 0 };
    },
    refetchInterval: 30000,
    staleTime: 20000,
    retry: 1,
  });
};

export const useAllTimeCallStats = (extension?: string, enabled = true) => {
  return useQuery({
    queryKey: ['call-stats-all-time', extension ?? null],
    enabled,
    queryFn: async () => {
      const response = await callsApi.allTimeStats(extension);
      const data = response?.data || response;
      return data || { totalCalls: 0, answered: 0, missed: 0, totalTalkDuration: 0, totalRingDuration: 0 };
    },
    refetchInterval: 60000,
    staleTime: 30000,
    retry: 1,
  });
};
