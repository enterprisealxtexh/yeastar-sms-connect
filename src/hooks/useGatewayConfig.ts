import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface GatewayConfig {
  id: string;
  gateway_ip: string;
  api_username: string;
  api_password: string;
}

export const useGatewayConfig = () => {
  const queryClient = useQueryClient();

  const { data: config, isLoading, error } = useQuery({
    queryKey: ["gateway-config"],
    queryFn: async () => {
      // Fetch from local API
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/gateway-config`);
      if (!response.ok) throw new Error("Failed to fetch gateway config");
      const result = await response.json();
      return result.data as GatewayConfig;
    },
  });

  const updateConfig = useMutation({
    mutationFn: async (updates: Partial<Omit<GatewayConfig, "id">>) => {
      const apiUrl = import.meta.env.VITE_API_URL;
      console.log('[useGatewayConfig] mutationFn called with updates:', updates);
      console.log('[useGatewayConfig] API URL:', apiUrl);
      
      try {
        const requestBody = {
          gateway_ip: updates.gateway_ip,
          api_username: updates.api_username,
          api_password: updates.api_password,
        };
        console.log('[useGatewayConfig] Sending POST request:', requestBody);
        
        const response = await fetch(`${apiUrl}/api/gateway-config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        
        console.log('[useGatewayConfig] Response status:', response.status);
        const data = await response.json();
        console.log('[useGatewayConfig] Response data:', data);
        
        if (!response.ok) {
          throw new Error(data.error || "Failed to save gateway config");
        }

        console.log('[useGatewayConfig] ✓ Successfully saved gateway config');
        return data;
      } catch (err) {
        console.error('[useGatewayConfig] Error in mutationFn:', err);
        throw err;
      }
    },
    onSuccess: () => {
      console.log('[useGatewayConfig] onSuccess called - invalidating cache');
      queryClient.invalidateQueries({ queryKey: ["gateway-config"] });
      // Also invalidate sim ports to refresh gateway connection status
      queryClient.invalidateQueries({ queryKey: ["sim-ports"] });
      console.log('[useGatewayConfig] Invalidated both gateway-config and sim-ports queries');
    },
    onError: (error) => {
      console.error('[useGatewayConfig] onError called:', error);
    },
  });

  return {
    config,
    isLoading,
    error,
    updateConfig,
  };
};
