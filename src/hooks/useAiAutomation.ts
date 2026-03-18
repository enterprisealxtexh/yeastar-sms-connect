import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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

  // Stub: no AI backend in local mode
  const recommendations = useQuery({
    queryKey: ["ai-recommendations"],
    queryFn: async (): Promise<AiRecommendation[]> => [],
    staleTime: Infinity,
  });

  // Run specific AI action (stub)
  const runAiAction = useMutation({
    mutationFn: async (action: string) => {
      void action;
      throw new Error("AI diagnostics are not available in local mode");
    },
    onError: (error: Error) => {
      toast({
        title: "AI Action Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Apply a recommendation (stub)
  const applyRecommendation = useMutation({
    mutationFn: async (_recommendationId: string) => {
      throw new Error("Not available in local mode");
    },
    onError: (error: Error) => {
      toast({
        title: "Apply Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Dismiss a recommendation (stub — optimistic in-memory only)
  const dismissRecommendation = useMutation({
    mutationFn: async (_recommendationId: string) => {
      // No-op
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-recommendations"] });
    },
  });

  // Clear resolved (stub)
  const clearResolved = useMutation({
    mutationFn: async () => {
      // No-op
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
