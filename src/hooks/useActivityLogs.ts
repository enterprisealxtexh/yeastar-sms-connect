import { useQuery } from "@tanstack/react-query";
import { configApi } from "@/lib/api-client";
import { format } from "date-fns";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
}

export const useActivityLogs = (limit = 50, enabled = true) => {
  return useQuery({
    queryKey: ['activity-logs', limit],
    enabled,
    queryFn: async (): Promise<LogEntry[]> => {
      const data = await configApi.activityLogs({ limit });
      return (data || []).map((log: any) => ({
        id: log.id,
        timestamp: format(new Date(log.created_at), 'HH:mm:ss'),
        level: log.severity,
        message: log.message,
      }));
    },
    refetchInterval: 30000,
    staleTime: 15000,
    retry: 1,
  });
};
