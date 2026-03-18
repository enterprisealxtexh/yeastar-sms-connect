import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { gatewayApi } from "@/lib/api-client";

export interface PbxConfig {
  id: string;
  pbx_ip: string;
  pbx_port: number;
  api_username: string;
  api_password: string;
  web_port: number;
}

export const usePbxConfig = (enabled = true) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: config, isLoading, error } = useQuery({
    queryKey: ['pbx-config'],
    enabled,
    queryFn: async () => (await gatewayApi.pbxConfig()) as PbxConfig | null,
    staleTime: 5 * 60 * 1000,
  });

  const updateConfig = useMutation({
    mutationFn: async (updates: Partial<Omit<PbxConfig, 'id'>>) => {
      const result = await gatewayApi.savePbxConfig(updates);
      if (!result.success) throw new Error(result.error || 'Failed to save PBX config');
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pbx-config'] });
      queryClient.invalidateQueries({ queryKey: ['pbx-status'] });
      toast({ title: 'Configuration Saved', description: 'PBX configuration has been updated.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Save Failed', description: error.message, variant: 'destructive' });
    },
  });

  return { config, isLoading, error, updateConfig };
};
