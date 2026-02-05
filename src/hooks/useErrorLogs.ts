import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export interface ErrorLog {
  id: string;
  agent_id: string | null;
  error_type: string;
  error_message: string;
  error_context: Record<string, unknown> | null;
  auto_fix_attempted: boolean;
  auto_fix_result: string | null;
  ai_diagnosis: string | null;
  ai_suggested_fix: string | null;
  resolved: boolean;
  created_at: string;
}

export const useErrorLogs = (limit = 50) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Subscribe to realtime error logs
  useEffect(() => {
    const channel = supabase
      .channel("error-logs-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "error_logs",
        },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ["error-logs"] });
          
          // Show toast for new errors
          const newError = payload.new as ErrorLog;
          toast({
            title: "New Error Detected",
            description: `${newError.error_type}: ${newError.error_message.substring(0, 100)}`,
            variant: "destructive",
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, toast]);

  const query = useQuery({
    queryKey: ["error-logs", limit],
    queryFn: async (): Promise<ErrorLog[]> => {
      const { data, error } = await supabase
        .from("error_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data || []).map(item => ({
        ...item,
        error_context: item.error_context as Record<string, unknown> | null,
      }));
    },
  });

  const diagnoseError = useMutation({
    mutationFn: async (errorId: string) => {
      const { data, error } = await supabase.functions.invoke("ai-diagnostics", {
        body: { action: "diagnose", error_id: errorId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["error-logs"] });
      toast({
        title: "Diagnosis Complete",
        description: "AI has analyzed the error and provided recommendations.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Diagnosis Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const markResolved = useMutation({
    mutationFn: async (errorId: string) => {
      const { error } = await supabase
        .from("error_logs")
        .update({ resolved: true })
        .eq("id", errorId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["error-logs"] });
    },
  });

  return {
    ...query,
    diagnoseError,
    markResolved,
    unresolvedCount: query.data?.filter(e => !e.resolved).length || 0,
  };
};
