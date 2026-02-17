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
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:2003";
      
      const response = await fetch(`${apiUrl}/api/statistics`);
      if (!response.ok) throw new Error("Failed to fetch statistics");
      
      const data = await response.json();
      const stats = data.data || data;
      
      // Calculate total and active SIMs
      const portStatus = stats.portStatus || [];
      const totalSims = portStatus.length;
      
      // Count active SIMs (enabled ports)
      const activeSims = portStatus.filter((port: any) => port.enabled === true || port.enabled === 1).length;
      
      // Get available ports (enabled ports)
      const availablePorts = portStatus
        .filter((port: any) => port.enabled === true || port.enabled === 1)
        .map((port: any) => port.port_number)
        .sort((a: number, b: number) => a - b);

      return {
        totalMessages: stats.totalMessages || 0,
        activeSims,
        totalSims,
        availablePorts,
        unreadMessages: stats.unreadMessages || 0,
      };
    },
    refetchInterval: 5000, // 5 seconds for near real-time updates
  });
};
