import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { configApi } from '@/lib/api-client';

export function useSmsSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['sms-settings'],
    queryFn: async () => {
      const data = await configApi.smsEnabled();
      return (data as any).sms_enabled;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const result = await configApi.setSmsEnabled(enabled);
      if (!result.success) throw new Error(result.error || 'Failed to update SMS settings');
      return (result.data as any)?.sms_enabled;
    },
    onSuccess: (newValue) => queryClient.setQueryData(['sms-settings'], newValue),
  });

  return {
    smsEnabled: query.data ?? true,
    isLoading: query.isLoading,
    isMutating: updateMutation.isPending,
    toggleSms: (enabled: boolean) => updateMutation.mutateAsync(enabled),
  };
}
