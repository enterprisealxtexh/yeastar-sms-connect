import { useQuery } from "@tanstack/react-query";

export interface GatewayStatus {
  configured: boolean;
  connected: boolean;
  gateway_ip: string | null;
  gateway_port: number | null;
  timestamp: string;
}

export const useGatewayStatus = () => {
  return useQuery({
    queryKey: ["gateway-status"],
    queryFn: async () => {
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:2003";
      try {
        const response = await fetch(`${apiUrl}/api/gateway-status`);
        if (!response.ok) throw new Error("Failed to fetch gateway status");
        const data = await response.json();
        return data as GatewayStatus;
      } catch (error) {
        console.error("Error fetching gateway status:", error);
        // Return default offline status instead of throwing
        return {
          configured: false,
          connected: false,
          gateway_ip: null,
          gateway_port: null,
          timestamp: new Date().toISOString(),
        } as GatewayStatus;
      }
    },
    refetchInterval: 5000, // Refetch every 5 seconds to stay current
    staleTime: 1000, // Data is stale after 1 second
    retry: 2, // Retry twice on failure
  });
};
