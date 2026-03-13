import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

export interface CallAutoSmsConfig {
  id: string;
  enabled: boolean;
  answered_message: string;
  missed_message: string;
  created_at: string;
  updated_at: string;
}

export const useCallAutoSmsConfig = () => {
  return useQuery({
    queryKey: ["call-auto-sms-config"],
    queryFn: async (): Promise<CallAutoSmsConfig | null> => {
      const res = await fetch(`${API_URL}/api/call-auto-sms-config`);
      const json = await res.json();
      return json.data ?? null;
    },
    staleTime: 30_000,
  });
};

export const useUpdateCallAutoSmsConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { enabled: boolean; answered_message: string; missed_message: string }) => {
      const res = await fetch(`${API_URL}/api/call-auto-sms-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to save");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["call-auto-sms-config"] });
    },
  });
};
