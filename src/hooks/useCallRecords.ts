import { useQuery } from "@tanstack/react-query";

const apiUrl = import.meta.env.VITE_API_URL;

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

export const useCallRecords = (page = 1, pageSize = 100, extension?: string, direction?: string, status?: string) => {
  return useQuery({
    queryKey: ["call-records", page, pageSize, extension, direction, status],
    queryFn: async () => {
      let url = `${apiUrl}/api/call-records?page=${page}&pageSize=${pageSize}`;
      if (extension && extension !== "all") {
        url += `&extension=${extension}`;
      }
      if (direction && direction !== "all") {
        url += `&direction=${direction}`;
      }
      if (status && status !== "all") {
        url += `&status=${status}`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch call records');
      }
      return await response.json();
    },
    refetchInterval: 5000, // CRITICAL: Every 5 seconds for real-time calls
    staleTime: 1000, // Fresh data required
    retry: 2, // Restored for reliability
  });
};

export const useCallStats = () => {
  return useQuery({
    queryKey: ["call-stats"],
    queryFn: async () => {
      const response = await fetch(`${apiUrl}/api/call-stats`);
      if (!response.ok) {
        throw new Error('Failed to fetch call stats');
      }
      const result = await response.json();
      return result.data || {
        totalCalls: 0,
        answered: 0,
        missed: 0,
        totalTalkDuration: 0,
        totalRingDuration: 0,
      };
    },
    refetchInterval: 30000, // Increased from 5 to 30 seconds
    staleTime: 20000, // 20 second stale time
    retry: 1, // Reduced from 2 to 1
  });
};

export const useAllTimeCallStats = () => {
  return useQuery({
    queryKey: ["call-stats-all-time"],
    queryFn: async () => {
      const response = await fetch(`${apiUrl}/api/call-stats/all-time`);
      if (!response.ok) {
        throw new Error('Failed to fetch all-time call stats');
      }
      const result = await response.json();
      return result.data || {
        totalCalls: 0,
        answered: 0,
        missed: 0,
        totalTalkDuration: 0,
        totalRingDuration: 0,
      };
    },
    refetchInterval: 60000, // Increased from 5 to 60 seconds - static data
    staleTime: 30000, // 30 second stale time
    retry: 1, // Reduced from 2 to 1
  });
};
