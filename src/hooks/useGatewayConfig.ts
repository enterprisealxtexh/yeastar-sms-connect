import { useQuery } from "@tanstack/react-query";
import { gatewayApi } from "@/lib/api-client";
import { useConfigSaveMutation } from "@/hooks/useConfigSaveMutation";

export interface GatewayConfig {
  id: string;
  gateway_ip: string;
  api_username: string;
  api_password: string;
}

export const useGatewayConfig = () => {
  const { data: config, isLoading, error } = useQuery({
    queryKey: ['gateway-config'],
    queryFn: async () => {
      const response = await gatewayApi.config();
      return (response?.data || response) as GatewayConfig;
    },
  });

  const updateConfig = useConfigSaveMutation<Partial<Omit<GatewayConfig, 'id'>>, any>({
    queryKeysToInvalidate: ['gateway-config', 'sim-ports'],
    saveFn: (updates) =>
      gatewayApi.saveConfig({
        gateway_ip: updates.gateway_ip,
        api_username: updates.api_username,
        api_password: updates.api_password,
      }),
  });

  return { config, isLoading, error, updateConfig };
};
