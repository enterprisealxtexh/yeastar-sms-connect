import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useEffect } from "react";
import { toast } from "sonner";
import type { SmsCategory } from "@/components/SmsCategoryBadge";

export interface SmsMessage {
  id: string;
  sender: string;
  simPort: number;
  content: string;
  timestamp: string;
  receivedAt: Date;
  isNew: boolean;
  category: SmsCategory;
  categoryConfidence?: number;
}

export const useSmsMessages = (limit = 50) => {
  const queryClient = useQueryClient();

  // Subscribe to realtime changes
  useEffect(() => {
    const channel = supabase
      .channel("sms-messages-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sms_messages",
        },
        () => {
          // Invalidate and refetch on any change
          queryClient.invalidateQueries({ queryKey: ["sms-messages"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["sms-messages", limit],
    queryFn: async (): Promise<SmsMessage[]> => {
      const { data, error } = await supabase
        .from("sms_messages")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).map((msg) => ({
        id: msg.id,
        sender: msg.sender_number,
        simPort: msg.sim_port,
        content: msg.message_content,
        timestamp: format(new Date(msg.received_at), "HH:mm:ss"),
        receivedAt: new Date(msg.received_at),
        isNew: msg.status === "unread",
        category: (msg.category as SmsCategory) || "unknown",
        categoryConfidence: msg.category_confidence ?? undefined,
      }));
    },
    refetchInterval: 30000, // Fallback polling every 30 seconds
  });
};

export const useCategorizeMessages = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options?: { messageId?: string; batch?: boolean }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        throw new Error("Authentication required");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/categorize-sms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(options?.batch ? { batch: true } : { message_id: options?.messageId }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sms-messages"] });
      if (data.batch) {
        toast.success(`Categorized ${data.processed} messages`);
      } else {
        toast.success("Message categorized");
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to categorize messages");
    },
  });
};
