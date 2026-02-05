import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { toast } from "sonner";

export interface CallQueueItem {
  id: string;
  from_extension: string;
  to_number: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  priority: number;
  requested_by: string | null;
  requested_at: string;
  picked_up_at: string | null;
  completed_at: string | null;
  result: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const useCallQueue = () => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["call-queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_queue")
        .select("*")
        .order("requested_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as CallQueueItem[];
    },
    refetchInterval: 5000,
  });

  // Realtime subscription for status updates
  useEffect(() => {
    const channel = supabase
      .channel("call-queue-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_queue" },
        (payload) => {
          query.refetch();
          
          // Show toast for status updates
          if (payload.eventType === "UPDATE") {
            const newRecord = payload.new as CallQueueItem;
            if (newRecord.status === "completed") {
              toast.success(`Call to ${newRecord.to_number} completed`);
            } else if (newRecord.status === "failed") {
              toast.error(`Call to ${newRecord.to_number} failed: ${newRecord.error_message || "Unknown error"}`);
            } else if (newRecord.status === "in_progress") {
              toast.info(`Initiating call to ${newRecord.to_number}...`);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [query]);

  return query;
};

export const useInitiateCall = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      fromExtension, 
      toNumber, 
      priority = 0 
    }: { 
      fromExtension: string; 
      toNumber: string; 
      priority?: number;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from("call_queue")
        .insert({
          from_extension: fromExtension,
          to_number: toNumber,
          priority,
          requested_by: userData?.user?.id || null,
          status: "pending",
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["call-queue"] });
      toast.success("Call queued - waiting for agent pickup");
    },
    onError: (error) => {
      toast.error(`Failed to queue call: ${error.message}`);
    },
  });
};

export const useCancelCall = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (callId: string) => {
      const { error } = await supabase
        .from("call_queue")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", callId)
        .eq("status", "pending");

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["call-queue"] });
      toast.info("Call cancelled");
    },
  });
};
