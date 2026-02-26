import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/integrations/supabase/api-client";
import { format } from "date-fns";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
}

export const useActivityLogs = (limit = 50) => {

  return useQuery({
    queryKey: ["activity-logs", limit],
    queryFn: async (): Promise<LogEntry[]> => {
      const { data, error } = await apiClient.getActivityLogs({ limit });

      if (error) throw error;

      return (data || []).map((log) => ({
        id: log.id,
        timestamp: format(new Date(log.created_at), "HH:mm:ss"),
        level: log.severity,
        message: log.message,
      }));
    },
    refetchInterval: 120000, // 2 minutes - activity logs are not time-critical
    staleTime: 60000, // 60 second stale time
    retry: 1, // Reduced from 2 to 1
  });
};
