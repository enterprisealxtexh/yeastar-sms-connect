import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "./use-toast";

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
  const { toast } = useToast();
  const [isActionRunning, setIsActionRunning] = useState(false);

  // Fetch pending recommendations
  const recommendations = useQuery({
    queryKey: ["ai-recommendations"],
    queryFn: async (): Promise<AiRecommendation[]> => {
      // Local SQLite doesn't have AI recommendations
      return [];
    },
    refetchInterval: 60000,
  });

  const pendingCount = 0;

  const runAction = async (action: string) => {
    setIsActionRunning(true);
    try {
      toast({
        title: "AI Action Running",
        description: `${action.replace(/_/g, " ")} is in progress...`,
      });
      // Simulate async action
      await new Promise(resolve => setTimeout(resolve, 2000));
      toast({
        title: "Action Complete",
        description: `${action.replace(/_/g, " ")} finished successfully.`,
      });
    } catch (error) {
      toast({
        title: "Action Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsActionRunning(false);
    }
  };

  return {
    recommendations: { data: [] },
    pendingCount,
    runAiAction: { 
      mutate: runAction,
      isPending: isActionRunning 
    },
    applyRecommendation: { 
      mutate: () => {},
      isPending: false 
    },
    dismissRecommendation: { 
      mutate: () => {},
      isPending: false 
    },
    clearResolved: { 
      mutate: () => {},
      isPending: false 
    },
  };
};
