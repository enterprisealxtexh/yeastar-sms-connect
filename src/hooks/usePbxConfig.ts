import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface PbxConfig {
  id: string;
  pbx_ip: string;
  pbx_port: number;
  api_username: string;
  api_password: string;
  web_port: number;
}

const apiUrl = import.meta.env.VITE_API_URL;

export const usePbxConfig = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: config, isLoading, error } = useQuery({
    queryKey: ["pbx-config"],
    queryFn: async () => {
      const response = await fetch(`${apiUrl}/api/pbx-config`);
      if (!response.ok) throw new Error('Failed to fetch PBX config');
      const result = await response.json();
      return (result.data || {}) as PbxConfig | null;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const updateConfig = useMutation({
    mutationFn: async (updates: Partial<Omit<PbxConfig, "id">>) => {
      const response = await fetch(`${apiUrl}/api/pbx-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      
      if (!response.ok) throw new Error('Failed to save PBX config');
      const result = await response.json();
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pbx-config"] });
      queryClient.invalidateQueries({ queryKey: ["pbx-status"] });
      toast({
        title: "Configuration Saved",
        description: "PBX configuration has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    config,
    isLoading,
    error,
    updateConfig,
  };
};
