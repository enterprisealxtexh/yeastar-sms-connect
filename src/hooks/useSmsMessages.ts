import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { format, isToday, isYesterday } from "date-fns";
import { useEffect } from "react";
import { toast } from "sonner";
import type { SmsCategory } from "@/components/SmsCategoryBadge";

export interface SmsMessage {
  id: string;
  sender: string;
  simPort: number;  // Legacy: Port number (1-4)
  gsmSpan: number;  // New: GSM span (2-5) source of truth
  portName: string; // Display name from gsm_span_config
  content: string;
  timestamp: string;
  receivedAt: Date;
  isNew: boolean;
  category: SmsCategory;
  categoryConfidence?: number;
  status?: string;
}

// Helper function to format timestamp with relative dates
const formatTimestampWithRelativeDate = (date: Date): string => {
  if (isToday(date)) {
    return `today ${format(date, "HH:mm:ss")}`;
  } else if (isYesterday(date)) {
    return `yesterday ${format(date, "HH:mm:ss")}`;
  } else {
    return format(date, "yyyy-MM-dd HH:mm:ss");
  }
};

export const useSmsMessages = (limit = 50) => {
  const queryClient = useQueryClient();
  const apiUrl = import.meta.env.VITE_API_URL;

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

        return data.map((msg: any) => {
          const msgDate = new Date(msg.received_at);
          return {
            id: msg.id,
            sender: msg.sender_number,
            simPort: msg.gsm_span ? msg.gsm_span - 1 : msg.sim_port,
            gsmSpan: msg.gsm_span || (msg.sim_port ? msg.sim_port + 1 : null),
            portName: msg.port_name || `Port ${msg.gsm_span ? msg.gsm_span - 1 : msg.sim_port}`,
            content: msg.message_content,
            timestamp: formatTimestampWithRelativeDate(msgDate),
            receivedAt: msgDate,
            isNew: msg.status === "unread",
            status: msg.status,
            category: (msg.category as SmsCategory) || "unknown",
            categoryConfidence: msg.category_confidence ?? undefined,
          };
        });
      } catch (error) {
        console.error("Error fetching SMS messages:", error);
        return [];
      }
    },
    refetchInterval: 3000, // CRITICAL: Every 3 seconds for real-time SMS
    retry: 2, // Restored for reliability
    staleTime: 1000, // Fresh data required
  });
};;

export const useCategorizeMessages = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options?: { messageId?: string; batch?: boolean }) => {
      // For now, just update the status locally
      const apiUrl = import.meta.env.VITE_API_URL;
      
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
  const apiUrl = import.meta.env.VITE_API_URL;

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
