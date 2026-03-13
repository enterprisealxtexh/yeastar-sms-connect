import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API_URL = import.meta.env.VITE_API_URL;

export function useSmsSettings() {
  const queryClient = useQueryClient();
  const token = localStorage.getItem('authToken');

  // Fetch SMS enabled status
  const query = useQuery({
    queryKey: ['sms-settings'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/system-settings/sms-enabled`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Failed to fetch SMS settings');
      const data = await response.json();
      return data.sms_enabled;
    },
  });

  // Update SMS enabled status
  const updateMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await fetch(`${API_URL}/api/system-settings/sms-enabled`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error('Failed to update SMS settings');
      const data = await response.json();
      return data.sms_enabled;
    },
    onSuccess: (newValue) => {
      queryClient.setQueryData(['sms-settings'], newValue);
    },
  });

  return {
    smsEnabled: query.data ?? true,
    isLoading: query.isLoading,
    isMutating: updateMutation.isPending,
    toggleSms: (enabled: boolean) => updateMutation.mutateAsync(enabled),
  };
}
