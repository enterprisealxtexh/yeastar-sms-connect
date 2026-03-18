import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { configApi } from "@/lib/api-client";

export interface AutoReplyConfig {
  id: string;
  enabled: boolean;
  message: string;
  notification_email: string | null;
  allowed_extensions: string[];
  created_at: string;
  updated_at: string;
}

export const useAutoReplyConfig = () => {
  return useQuery({
    queryKey: ['auto-reply-config'],
    queryFn: async (): Promise<AutoReplyConfig | null> => (await configApi.autoReply()) ?? null,
    staleTime: 30_000,
  });
};

export const useUpdateAutoReplyConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { enabled: boolean; message: string; notification_email?: string | null; allowed_extensions?: string[] }) => {
      const result = await configApi.saveAutoReply(payload);
      if (!result.success) throw new Error(result.error || 'Failed to save');
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auto-reply-config'] }),
  });
};
