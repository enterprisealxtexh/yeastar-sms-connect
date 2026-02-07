import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type TelegramAction =
  | "system_summary"
  | "sms_logs"
  | "call_logs"
  | "activity_logs"
  | "gateway_status"
  | "error_logs";

export const useTelegramNotify = () => {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (action: TelegramAction) => {
      const { data, error } = await supabase.functions.invoke("telegram-notify", {
        body: { action },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, action) => {
      const labels: Record<TelegramAction, string> = {
        system_summary: "System Summary",
        sms_logs: "SMS Logs",
        call_logs: "Call Logs",
        activity_logs: "Activity Logs",
        gateway_status: "Gateway & PBX Status",
        error_logs: "Error Logs",
      };
      toast({
        title: "Sent to Telegram",
        description: `${labels[action]} has been sent to your Telegram bot.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Telegram Send Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
};
