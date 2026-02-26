import { useQuery } from "@tanstack/react-query";

export interface DashboardStats {
  totalMessages: number;
  activeSims: number;
  totalSims: number;
  availablePorts: number[];
  unreadMessages: number;
}

export const useDashboardStats = () => {
  return useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async (): Promise<DashboardStats> => {
      const apiUrl = import.meta.env.VITE_API_URL;
      
      // First, trigger a fresh hardware check to update database with latest GSM span status
      try {
        await fetch(`${apiUrl}/api/check-gsm-spans`, { method: 'POST' });
      } catch (error) {
        console.warn('Failed to check GSM spans, using cached data:', error);
      }
      
      // Fetch ALL stats for total messages and unread count
      const statsResponse = await fetch(`${apiUrl}/api/statistics`);
      if (!statsResponse.ok) throw new Error("Failed to fetch statistics");
      const statsData = await statsResponse.json();
      const stats = statsData.data || statsData;

      // Fetch GSM spans from database (now updated with fresh hardware status)
      const gsmSpansResponse = await fetch(`${apiUrl}/api/gsm-spans`);
      if (!gsmSpansResponse.ok) throw new Error("Failed to fetch GSM spans");
      const gsmSpansData = await gsmSpansResponse.json();
      const gsmSpans = gsmSpansData.data || [];

      // Calculate total and active SIMs from GSM span status
      const totalSims = gsmSpans.length;
      
      // Count active SIMs based on database is_active (updated from hardware check)
      const activeSims = gsmSpans.filter((span: any) => span.is_active === 1).length;
      
      // Get available ports (convert GsmSpan to Port: Port = GsmSpan - 1)
      const availablePorts = gsmSpans
        .filter((span: any) => span.is_active === 1)
        .map((span: any) => span.gsm_span - 1)  // Convert GsmSpan to Port (2->1, 3->2, etc)
        .sort((a: number, b: number) => a - b);

      return {
        totalMessages: stats.totalMessages || 0,
        activeSims,
        totalSims,
        availablePorts,
        unreadMessages: stats.unreadMessages || 0,
      };
    },
    refetchInterval: 5000, // Poll every 5 seconds to sync with SMS/calls
    staleTime: 1000, // Consider stale after 1 second
    retry: 1,
  });
};
