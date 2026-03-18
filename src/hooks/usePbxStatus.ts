import { useQuery } from "@tanstack/react-query";
import { gatewayApi } from "@/lib/api-client";

export interface PbxStatus {
  configured: boolean;
  connected: boolean;
  status?: string;
  error?: string | null;
  pbx_ip: string | null;
  pbx_port: number | null;
  timestamp: string;
}

export const usePbxStatus = (enabled = true) => {
  return useQuery({
    queryKey: ['pbx-status'],
    enabled,
    queryFn: async (): Promise<PbxStatus> => {
      try {
        return (await gatewayApi.pbxStatus()) as PbxStatus;
      } catch (error) {
        return {
          configured: false, connected: false, status: 'Failed',
          error: error instanceof Error ? error.message : 'Failed to fetch PBX status',
          pbx_ip: null, pbx_port: null, timestamp: new Date().toISOString(),
        };
      }
    },
    refetchInterval: 30000,
    staleTime: 15000,
    retry: 1,
  });
};
