import { useQuery } from '@tanstack/react-query';
import { callsApi } from '@/lib/api-client';

export interface CallLog {
  [key: string]: string | number;
}

export interface CallLogsData {
  inbound: { count: number; calls: CallLog[] };
  outbound: { count: number; calls: CallLog[] };
  total: number;
  allCalls: Array<CallLog & { type: 'inbound' | 'outbound' }>;
}

export const useCallLogs = () => {
  const { data: logs, isLoading, error, refetch } = useQuery({
    queryKey: ['call-logs'],
    queryFn: async (): Promise<CallLogsData | null> => {
      const result = await callsApi.pbxLogs();
      if (!result.success) throw new Error(result.error || 'Failed to fetch call logs');
      return result.data as CallLogsData || null;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });

  return { logs: logs ?? null, isLoading, error: error?.message ?? null, refetch };
};
