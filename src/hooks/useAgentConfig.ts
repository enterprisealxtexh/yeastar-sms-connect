import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface AgentConfig {
  id: string;
  config_key: string;
  config_value: {
    value?: number;
    min?: number;
    max?: number;
    enabled?: boolean;
  };
  ai_tuned: boolean;
  last_tuned_at: string | null;
  updated_at: string;
}

export const useAgentConfig = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ["agent-config"],
    queryFn: async (): Promise<AgentConfig[]> => {
      // agent_config table not available in local SQLite mode
      return [];
    },
  });

  const updateConfig = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      toast({
        title: "Configuration Update",
        description: "Agent configuration updates are not available in local development mode.",
        variant: "default",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-config"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const triggerAiTuning = useMutation({
    mutationFn: async () => {
      // AI tuning requires edge function not available in local mode
      toast({
        title: "AI Tuning Unavailable",
        description: "AI configuration tuning is not available in local development mode.",
        variant: "default",
      });
      return { tuning: { recommendations: [] } };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["agent-config"] });
      const count = data?.tuning?.recommendations?.length || 0;
      toast({
        title: "AI Tuning Status",
        description: count > 0 
          ? `Made ${count} configuration adjustment(s)`
          : "No adjustments needed at this time",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "AI Tuning Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    ...query,
    updateConfig,
    triggerAiTuning,
  };
};
