import { useQuery } from "@tanstack/react-query";
import { callsApi, gatewayApi } from "@/lib/api-client";

export interface DashboardStats {
  totalMessages: number;
  activeSims: number;
  totalSims: number;
  availablePorts: number[];
  unreadMessages: number;
}

export const useDashboardStats = (enabled = true) => {
  return useQuery({
    queryKey: ['dashboard-stats'],
    enabled,
    queryFn: async (): Promise<DashboardStats> => {
      // Trigger a fresh hardware check
      gatewayApi.checkGsmSpans().catch(() => {});

      const [stats, gsmSpans] = await Promise.all([
        callsApi.statistics(),
        gatewayApi.gsmSpans(),
      ]);

      const totalSims = gsmSpans.length;
      const activeSims = gsmSpans.filter((s: any) => s.is_active === 1).length;
      const availablePorts = gsmSpans
        .filter((s: any) => s.is_active === 1)
        .map((s: any) => s.gsm_span - 1)
        .sort((a: number, b: number) => a - b);

      return {
        totalMessages: stats.totalMessages || 0,
        activeSims,
        totalSims,
        availablePorts,
        unreadMessages: stats.unreadMessages || 0,
      };
    },
    refetchInterval: 5000,
    staleTime: 1000,
    refetchOnMount: true,
    retry: 1,
  });
};
