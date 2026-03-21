import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { format, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";
import { smsApi, apiCall } from "@/lib/api-client";
import type { SmsCategory } from "@/components/SmsCategoryBadge";

export interface SmsMessage {
  id: string;
  sender: string;
  simPort: number;
  gsmSpan: number;
  portName: string;
  content: string;
  timestamp: string;
  receivedAt: Date;
  isNew: boolean;
  category: SmsCategory;
  categoryConfidence?: number;
  status?: string;
}

const formatTimestampWithRelativeDate = (date: Date): string => {
  if (isToday(date)) return `today ${format(date, 'HH:mm:ss')}`;
  if (isYesterday(date)) return `yesterday ${format(date, 'HH:mm:ss')}`;
  return format(date, 'yyyy-MM-dd HH:mm:ss');
};

export const useSmsMessages = (limit = 50, direction?: string, enabled = true) => {
  return useQuery({
    queryKey: ['sms-messages', limit, direction],
    enabled,
    queryFn: async (): Promise<SmsMessage[]> => {
      const response = await smsApi.messages({ limit, ...(direction ? { direction } : {}) });
      const data = response?.data || [];
      return (data || []).map((msg: any) => {
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
          isNew: msg.status === 'unread',
          status: msg.status,
          category: (msg.category as SmsCategory) || 'unknown',
          categoryConfidence: msg.category_confidence ?? undefined,
        };
      });
    },
    refetchInterval: 3000,
    staleTime: 1000,
    refetchOnMount: true,
    retry: 2,
  });
};

export const useCategorizeMessages = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (options?: { messageId?: string; batch?: boolean }) => {
      if (options?.messageId) {
        const result = await smsApi.updateStatus(options.messageId, 'processed');
        if (!result.success) throw new Error(result.error || 'Failed to categorize message');
      }
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sms-messages'] });
      toast.success('Message processed');
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to process message'),
  });
};

export const useMarkAllSmsAsRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await smsApi.markAllRead();
      if (!result.success) throw new Error(result.error || 'Failed to mark messages as read');
      return result.data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['sms-messages'] });
      toast.success(`${data?.changes ?? ''} messages marked as read`);
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to mark messages as read'),
  });
};
