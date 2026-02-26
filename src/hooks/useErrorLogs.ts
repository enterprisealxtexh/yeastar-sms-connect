import { useQuery } from "@tanstack/react-query";

export interface ErrorLog {
  id: string;
  agent_id: string | null;
  error_type: string;
  error_message: string;
  error_context: Record<string, unknown> | null;
  auto_fix_attempted: boolean;
  auto_fix_result: string | null;
  ai_diagnosis: string | null;
  ai_suggested_fix: string | null;
  resolved: boolean;
  created_at: string;
}

export const useErrorLogs = (limit = 50) => {
  return useQuery({
    queryKey: ["error-logs", limit],
    queryFn: async (): Promise<ErrorLog[]> => {
      // Local SQLite doesn't have a dedicated error_logs table
      // Return empty array
      return [];
    },
    refetchInterval: 120000, // 2 minutes - static/rarely changing data
    staleTime: 60000, // 60 second stale time
    retry: 1,
  });
};
