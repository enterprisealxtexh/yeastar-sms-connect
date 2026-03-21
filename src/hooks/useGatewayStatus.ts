import { useQuery } from "@tanstack/react-query";
import { gatewayApi } from "@/lib/api-client";

export interface GatewayStatus {
  configured: boolean;
  connected: boolean;
  gateway_ip: string | null;
  gateway_port: number | null;
  timestamp: string;
}

export const useGatewayStatus = (enabled = true) => {
  return useQuery({
    queryKey: ['gateway-status'],
    enabled,
    queryFn: async (): Promise<GatewayStatus> => {
      try {
        return (await gatewayApi.status()) as GatewayStatus;
      } catch (error) {
        return {
          configured: false, connected: false,
          gateway_ip: null, gateway_port: null, timestamp: new Date().toISOString(),
        };
      }
    },
    refetchInterval: 10000,  // Check every 10 seconds for real-time status
    staleTime: 5000,           // Consider data stale after 5 seconds
    retry: 1,
  });
};
