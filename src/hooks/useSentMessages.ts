import { useQuery } from "@tanstack/react-query";
import { format, isToday, isYesterday } from "date-fns";

export interface SentMessage {
  id: string;
  sender_number: string;  // Phone number sent from (System or SIM)
  message_content: string;
  received_at: string;    // Sent at timestamp
  gsm_span: number;
  portName?: string;
  status: string;
  direction: 'sent';
  category?: string;
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

export const useSentMessages = (limit = 50) => {
  const apiUrl = import.meta.env.VITE_API_URL;

  return useQuery({
    queryKey: ["sent-messages", limit],
    queryFn: async (): Promise<SentMessage[]> => {
      try {
        const response = await fetch(
          `${apiUrl}/api/sms-messages?direction=sent&limit=${limit}`
        );
        if (!response.ok) {
          console.warn(`API returned status ${response.status}`);
          return [];
        }
        const result = await response.json();
        const data = result.data || [];

        return data.map((msg: any) => {
          const receivedDate = new Date(msg.received_at);
          
          return {
            id: msg.id,
            sender_number: msg.sender_number || 'System',
            message_content: msg.message_content,
            received_at: formatTimestampWithRelativeDate(receivedDate),
            receivedDate,
            gsm_span: msg.gsm_span,
            status: msg.status || 'sent',
            direction: 'sent' as const,
            category: msg.category || 'sent',
          };
        });
      } catch (err) {
        console.error("Failed to fetch sent messages:", err);
        return [];
      }
    },
    refetchInterval: 5000, // Refetch every 5 seconds
  });
};
