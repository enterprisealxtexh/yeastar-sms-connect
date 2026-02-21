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
      
      // Fetch ALL stats for total messages and unread count
      const statsResponse = await fetch(`${apiUrl}/api/statistics`);
      if (!statsResponse.ok) throw new Error("Failed to fetch statistics");
      const statsData = await statsResponse.json();
      const stats = statsData.data || statsData;

      // Fetch TG400 ports with merged hardware + database status
      const portsResponse = await fetch(`${apiUrl}/api/tg400-ports`);
      if (!portsResponse.ok) throw new Error("Failed to fetch port configs");
      const portsData = await portsResponse.json();
      const portConfigs = portsData.data || [];

      // Calculate total and active SIMs based on TG400 hardware status
      const totalSims = portConfigs.length;
      
      // Count active SIMs based on TG400 hardware status (isUp)
      const activeSims = portConfigs.filter((port: any) => port.isUp === true).length;
      
      // Get available ports (ports that are active on hardware)
      const availablePorts = portConfigs
        .filter((port: any) => port.isUp === true)
        .map((port: any) => port.portNumber)
        .sort((a: number, b: number) => a - b);

      return {
        totalMessages: stats.totalMessages || 0,
        activeSims,
        totalSims,
        availablePorts,
        unreadMessages: stats.unreadMessages || 0,
      };
    },
    refetchInterval: false, // Manual refresh only via button click
  });
};
