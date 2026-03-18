import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { configApi } from "@/lib/api-client";

export interface CallAutoSmsConfig {
  id: string;
  enabled: boolean;
  answered_message: string;
  missed_message: string;
  delay_enabled?: boolean;
  delay_minutes?: number;
  duplicate_window?: number;
  allowed_ports?: number[];
  allowed_extensions?: string[];
  call_direction?: 'both' | 'inbound' | 'outbound';
  created_at: string;
  updated_at: string;
}

export const useCallAutoSmsConfig = () => {
  return useQuery({
    queryKey: ['call-auto-sms-config'],
    queryFn: async (): Promise<CallAutoSmsConfig | null> => (await configApi.callAutoSms()) ?? null,
    staleTime: 30_000,
  });
};

export const useUpdateCallAutoSmsConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      enabled: boolean;
      answered_message: string;
      missed_message: string;
      delay_enabled?: boolean;
      delay_minutes?: number;
      duplicate_window?: number;
      allowed_ports?: number[];
      allowed_extensions?: string[];
      call_direction?: 'both' | 'inbound' | 'outbound';
    }) => {
      const result = await configApi.saveCallAutoSms(payload);
      if (!result.success) throw new Error(result.error || 'Failed to save');
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['call-auto-sms-config'] }),
  });
};
