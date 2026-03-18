import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gatewayApi } from "@/lib/api-client";

export interface GatewayConfig {
  id: string;
  gateway_ip: string;
  api_username: string;
  api_password: string;
}

export const useGatewayConfig = () => {
  const queryClient = useQueryClient();

  const { data: config, isLoading, error } = useQuery({
    queryKey: ['gateway-config'],
    queryFn: async () => (await gatewayApi.config()) as GatewayConfig,
  });

  const updateConfig = useMutation({
    mutationFn: async (updates: Partial<Omit<GatewayConfig, 'id'>>) => {
      const result = await gatewayApi.saveConfig({
        gateway_ip: updates.gateway_ip,
        api_username: updates.api_username,
        api_password: updates.api_password,
      });
      if (!result.success) throw new Error(result.error || 'Failed to save gateway config');
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gateway-config'] });
      queryClient.invalidateQueries({ queryKey: ['sim-ports'] });
    },
  });

  return { config, isLoading, error, updateConfig };
};
