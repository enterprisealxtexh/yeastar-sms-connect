import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

export interface AutoReplyConfig {
  id: string;
  enabled: boolean;
  message: string;
  notification_email: string | null;
  created_at: string;
  updated_at: string;
}

export const useAutoReplyConfig = () => {
  return useQuery({
    queryKey: ["auto-reply-config"],
    queryFn: async (): Promise<AutoReplyConfig | null> => {
      const res = await fetch(`${API_URL}/api/auto-reply-config`);
      const json = await res.json();
      return json.data ?? null;
    },
    staleTime: 30_000,
  });
};

export const useUpdateAutoReplyConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { enabled: boolean; message: string; notification_email?: string | null }) => {
      const res = await fetch(`${API_URL}/api/auto-reply-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to save");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auto-reply-config"] });
    },
  });
};
