import { useQuery } from "@tanstack/react-query";

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:2003';

export interface CallRecord {
  id: string;
  external_id: string | null;
  caller_number: string;
  callee_number: string;
  caller_extension_username: string | null;
  callee_extension_username: string | null;
  direction: "inbound" | "outbound" | "internal";
  status: "answered" | "missed" | "busy" | "failed" | "voicemail";
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

export const useCallRecords = () => {
  return useQuery({
    queryKey: ["call-records"],
    queryFn: async () => {
      const response = await fetch(`${apiUrl}/api/call-records`);
      if (!response.ok) {
        throw new Error('Failed to fetch call records');
      }
      const result = await response.json();
      return result.data as CallRecord[];
    },
    refetchInterval: 5000, // 5 seconds for near real-time updates
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
    refetchInterval: 5000, // 5 seconds for near real-time updates
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
    refetchInterval: 5000, // 5 seconds for near real-time updates
  });
};
