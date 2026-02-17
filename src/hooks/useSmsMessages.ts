import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
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
  status?: string;
}

export const useSmsMessages = (limit = 50) => {
  const queryClient = useQueryClient();
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:2003";

  // Poll for changes (realtime not available with local SQLite)
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["sms-messages"] });
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [queryClient]);

  return useQuery({
    queryKey: ["sms-messages", limit],
    queryFn: async (): Promise<SmsMessage[]> => {
      try {
        const response = await fetch(
          `${apiUrl}/api/sms-messages?limit=${limit}`
        );
        if (!response.ok) {
          console.warn(`API returned status ${response.status}`);
          return [];
        }
        const result = await response.json();
        const data = result.data || [];

        return data.map((msg: any) => ({
          id: msg.id,
          sender: msg.sender_number,
          simPort: msg.sim_port,
          content: msg.message_content,
          timestamp: format(new Date(msg.received_at), "HH:mm:ss"),
          receivedAt: new Date(msg.received_at),
          isNew: msg.status === "unread",
          status: msg.status,
          category: (msg.category as SmsCategory) || "unknown",
          categoryConfidence: msg.category_confidence ?? undefined,
        }));
      } catch (error) {
        console.error("Error fetching SMS messages:", error);
        return []; // Return empty array on error instead of throwing
      }
    },
    refetchInterval: 5000, // Polling every 5 seconds
    retry: 2, // Retry twice on failure
    staleTime: 1000, // Data is stale after 1 second
  });
};;

export const useCategorizeMessages = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options?: { messageId?: string; batch?: boolean }) => {
      // For now, just update the status locally
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:2003";
      
      if (options?.messageId) {
        const response = await fetch(
          `${apiUrl}/api/sms-messages/${options.messageId}/status`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ status: "processed" }),
          }
        );
        if (!response.ok) throw new Error("Failed to categorize message");
        return { success: true };
      }

      return { success: true };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sms-messages"] });
      toast.success("Message processed");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to process message");
    },
  });
};

export const useMarkAllSmsAsRead = () => {
  const queryClient = useQueryClient();
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:2003";

  return useMutation({
    mutationFn: async () => {
      const response = await fetch(`${apiUrl}/api/sms-messages/mark-all-read`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Failed to mark messages as read");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sms-messages"] });
      toast.success(`${data.changes} messages marked as read`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to mark messages as read");
    },
  });
};
