import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

export type TelegramAction =
  | "system_summary"
  | "sms_logs"
  | "call_logs"
  | "activity_logs"
  | "gateway_status"
  | "error_logs";

export const useTelegramNotify = () => {
  const { toast } = useToast();
  const [isConfigured, setIsConfigured] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:2003';

  const checkConfig = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/telegram-config`);
      const data = await response.json();
      const configured = !!(data.data?.bot_token && data.data?.chat_id && (data.data?.enabled === 1 || data.data?.enabled === true));
      setIsConfigured(configured);
      return configured;
    } catch (error) {
      setIsConfigured(false);
      return false;
    } finally {
      setIsVerifying(false);
    }
  };

  // Check if Telegram is configured on mount
  useEffect(() => {
    checkConfig();
  }, []);

  return useMutation({
    mutationFn: async (action: TelegramAction) => {
      // Re-check config if it's currently false, just in case they just saved it
      let currentConfigured = isConfigured;
      if (!currentConfigured) {
        currentConfigured = await checkConfig();
      }

      if (!currentConfigured) {
        throw new Error('Telegram not configured. Please set up your bot token and chat ID in Configuration > Telegram and ensure "Enable Notifications" is checked.');
      }

      const response = await fetch(`${apiUrl}/api/telegram-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send Telegram notification');
      }

      return response.json();
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
        title: "Telegram Sent",
        description: `${labels[action]} sent to Telegram successfully.`,
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
