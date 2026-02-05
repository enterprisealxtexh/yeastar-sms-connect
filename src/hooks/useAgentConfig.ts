import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
      const { data, error } = await supabase
        .from("agent_config")
        .select("*")
        .order("config_key");

      if (error) throw error;
      return (data || []).map(item => ({
        ...item,
        config_value: item.config_value as AgentConfig["config_value"],
      }));
    },
  });

  const updateConfig = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      const { error } = await supabase
        .from("agent_config")
        .update({
          config_value: value as AgentConfig["config_value"],
          ai_tuned: false,
          updated_at: new Date().toISOString(),
        })
        .eq("config_key", key);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-config"] });
      toast({
        title: "Configuration Updated",
        description: "The agent will pick up the new settings on next poll.",
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

  const triggerAiTuning = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-diagnostics", {
        body: { action: "tune_config" },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["agent-config"] });
      const count = data?.tuning?.recommendations?.length || 0;
      toast({
        title: "AI Tuning Complete",
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
