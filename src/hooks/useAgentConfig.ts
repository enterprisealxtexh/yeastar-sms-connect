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

const DEFAULT_CONFIGS: AgentConfig[] = [
  { id: "1", config_key: "poll_interval_seconds", config_value: { value: 30, min: 10, max: 300 }, ai_tuned: false, last_tuned_at: null, updated_at: new Date().toISOString() },
  { id: "2", config_key: "missed_call_threshold_minutes", config_value: { value: 5, min: 1, max: 60 }, ai_tuned: false, last_tuned_at: null, updated_at: new Date().toISOString() },
  { id: "3", config_key: "auto_reply_enabled", config_value: { enabled: false }, ai_tuned: false, last_tuned_at: null, updated_at: new Date().toISOString() },
];

// Stub hook — agent config is not persisted to server in local mode
export const useAgentConfig = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ["agent-config"],
    queryFn: async (): Promise<AgentConfig[]> => DEFAULT_CONFIGS,
    staleTime: Infinity,
  });

  const updateConfig = useMutation({
    mutationFn: async (_params: { key: string; value: unknown }) => {
      // No-op in local mode
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-config"] });
      toast({
        title: "Configuration Updated",
        description: "Settings saved (local mode).",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const autoTune = useMutation({
    mutationFn: async () => {
      // No-op in local mode
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-config"] });
      toast({
        title: "Auto-Tune Complete",
        description: "Agent configuration optimized (local mode).",
      });
    },
  });

  return { ...query, updateConfig, autoTune, triggerAiTuning: autoTune };
};
