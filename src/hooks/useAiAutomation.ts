import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

export interface AiRecommendation {
  id: string;
  category: string;
  title: string;
  description: string;
  details: Record<string, unknown>;
  status: string;
  auto_applied: boolean;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export const useAiAutomation = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch pending recommendations
  const recommendations = useQuery({
    queryKey: ["ai-recommendations"],
    queryFn: async (): Promise<AiRecommendation[]> => {
      const { data, error } = await supabase
        .from("ai_recommendations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data || []) as AiRecommendation[];
    },
  });

  // Realtime subscription for new recommendations
  useEffect(() => {
    const channel = supabase
      .channel("ai-recommendations-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ai_recommendations" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["ai-recommendations"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Run specific AI action
  const runAiAction = useMutation({
    mutationFn: async (action: string) => {
      const { data, error } = await supabase.functions.invoke("ai-diagnostics", {
        body: { action },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, action) => {
      queryClient.invalidateQueries({ queryKey: ["ai-recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["agent-config"] });
      const labels: Record<string, string> = {
        auto_configure_sims: "SIM Auto-Config",
        auto_create_contacts: "Contact Discovery",
        suggest_actions: "Action Suggestions",
        resource_optimize: "Resource Optimization",
        auto_optimize: "Full Optimization",
      };
      toast({
        title: `${labels[action] || action} Complete`,
        description: getSuccessMessage(action, data),
      });
    },
    onError: (error: Error) => {
      toast({
        title: "AI Action Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Apply a recommendation
  const applyRecommendation = useMutation({
    mutationFn: async (recommendationId: string) => {
      const { data, error } = await supabase.functions.invoke("ai-diagnostics", {
        body: { action: "apply_recommendation", recommendation_id: recommendationId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["sim-ports"] });
      toast({ title: "Recommendation Applied" });
    },
    onError: (error: Error) => {
      toast({
        title: "Apply Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Dismiss a recommendation
  const dismissRecommendation = useMutation({
    mutationFn: async (recommendationId: string) => {
      const { error } = await supabase
        .from("ai_recommendations")
        .update({ status: "dismissed" })
        .eq("id", recommendationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-recommendations"] });
    },
  });

  // Clear all dismissed/applied
  const clearResolved = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("ai_recommendations")
        .delete()
        .in("status", ["dismissed", "applied"]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-recommendations"] });
      toast({ title: "Cleared resolved recommendations" });
    },
  });

  const pendingCount = recommendations.data?.filter(r => r.status === "pending").length || 0;

  return {
    recommendations,
    pendingCount,
    runAiAction,
    applyRecommendation,
    dismissRecommendation,
    clearResolved,
  };
};

function getSuccessMessage(action: string, data: Record<string, unknown>): string {
  const result = data?.result as Record<string, unknown> | undefined;
  const results = data?.results as Record<string, unknown> | undefined;
  
  switch (action) {
    case "auto_configure_sims":
      return `Found ${result?.recommendations_count || 0} SIM configuration suggestion(s)`;
    case "auto_create_contacts":
      return `Analyzed ${result?.contacts_analyzed || 0} contacts, suggested ${result?.names_suggested || 0} name(s)`;
    case "suggest_actions":
      return `Generated ${result?.actions_count || 0} action suggestion(s)`;
    case "resource_optimize":
      return `${result?.optimizations_count || 0} optimization(s), ${result?.auto_applied_count || 0} auto-applied`;
    case "auto_optimize":
      return `Full optimization complete across all subsystems`;
    default:
      return "Action completed successfully";
  }
}
