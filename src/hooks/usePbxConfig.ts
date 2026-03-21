import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { gatewayApi } from "@/lib/api-client";
import { useConfigSaveMutation } from "@/hooks/useConfigSaveMutation";

export interface PbxConfig {
  id: string;
  pbx_ip: string;
  pbx_port: number;
  api_username: string;
  api_password: string;
  web_port: number;
}

export const usePbxConfig = (enabled = true) => {
  const { toast } = useToast();

  const { data: config, isLoading, error } = useQuery({
    queryKey: ['pbx-config'],
    enabled,
    queryFn: async () => {
      const response = await gatewayApi.pbxConfig();
      return (response?.data || response) as PbxConfig | null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const updateConfig = useConfigSaveMutation<Partial<Omit<PbxConfig, 'id'>>, any>({
    queryKeysToInvalidate: ['pbx-config', 'pbx-status'],
    saveFn: (updates) => gatewayApi.savePbxConfig(updates),
    onSuccess: () => {
      toast({ title: 'Configuration Saved', description: 'PBX configuration has been updated.' });
    },
    onError: (error) => {
      toast({ title: 'Save Failed', description: error.message, variant: 'destructive' });
    },
  });

  return { config, isLoading, error, updateConfig };
};
