import { useQuery } from "@tanstack/react-query";

export interface CallQueueItem {
  id: string;
  from_extension: string;
  to_number: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  priority: number;
  requested_by: string | null;
  requested_at: string;
  picked_up_at: string | null;
  completed_at: string | null;
  result: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const useCallQueue = () => {
  return useQuery({
    queryKey: ["call-queue"],
    queryFn: async () => {
      // Local SQLite doesn't have a call_queue table
      return [];
    },
    refetchInterval: 60000, // Increased from 5 to 60 seconds - not critical
    staleTime: 30000, // 30 second stale time
    retry: 1,
  });
};
