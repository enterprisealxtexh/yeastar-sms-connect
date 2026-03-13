import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

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
      const response = await fetch(`${API_URL}/api/telegram-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to send Telegram notification");
      }
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
