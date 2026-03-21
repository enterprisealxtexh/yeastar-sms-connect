import { useQuery } from "@tanstack/react-query";
import { format, isToday, isYesterday } from "date-fns";
import { smsApi } from "@/lib/api-client";

export interface SentMessage {
  id: string;
  sender_number: string;
  message_content: string;
  received_at: string;
  gsm_span: number;
  portName?: string;
  status: string;
  direction: 'sent';
  category?: string;
}

const formatTimestamp = (date: Date): string => {
  if (isToday(date)) return `today ${format(date, 'HH:mm:ss')}`;
  if (isYesterday(date)) return `yesterday ${format(date, 'HH:mm:ss')}`;
  return format(date, 'yyyy-MM-dd HH:mm:ss');
};

export const useSentMessages = (limit = 50) => {
  return useQuery({
    queryKey: ['sent-messages', limit],
    queryFn: async (): Promise<SentMessage[]> => {
      const response = await smsApi.messages({ direction: 'sent', limit });
      const data = response?.data || [];
      return data.map((msg: any) => {
        const receivedDate = new Date(msg.received_at);
        return {
          id: msg.id,
          sender_number: msg.sender_number || 'System',
          message_content: msg.message_content,
          received_at: formatTimestamp(receivedDate),
          receivedDate,
          gsm_span: msg.gsm_span,
          status: msg.status || 'sent',
          direction: 'sent' as const,
          category: msg.category || 'sent',
        };
      });
    },
    refetchInterval: 5000,
    staleTime: 1000,
    refetchOnMount: true,
  });
};
