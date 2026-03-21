import { useQuery } from "@tanstack/react-query";
import { configApi } from "@/lib/api-client";
import { useConfigSaveMutation } from "@/hooks/useConfigSaveMutation";

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
    queryFn: async (): Promise<CallAutoSmsConfig | null> => {
      const response = await configApi.callAutoSms();
      return (response?.data || response) ?? null;
    },
    staleTime: 30_000,
  });
};

export const useUpdateCallAutoSmsConfig = () => {
  return useConfigSaveMutation<
    {
      enabled: boolean;
      answered_message: string;
      missed_message: string;
      delay_enabled?: boolean;
      delay_minutes?: number;
      duplicate_window?: number;
      allowed_ports?: number[];
      allowed_extensions?: string[];
      call_direction?: 'both' | 'inbound' | 'outbound';
    },
    any
  >({
    queryKeysToInvalidate: ['call-auto-sms-config'],
    saveFn: (payload) => configApi.saveCallAutoSms(payload),
    validate: (payload, result) => {
      if (result.data && result.data.enabled !== payload.enabled) {
        throw new Error('Settings did not save correctly - backend returned different values');
      }
    },
  });
};
