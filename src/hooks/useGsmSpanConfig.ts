import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { gatewayApi } from '@/lib/api-client';

export interface GsmSpan {
  gsm_span: number;
  name: string | null;
  phone_number: string | null;
  is_active: number;
  signal_strength: number;
  carrier: string | null;
  last_active_check: string | null;
}

export function useGsmSpanConfig() {
  const queryClient = useQueryClient();

  const { data: gsmSpans = [], isLoading: loading, error: rawError } = useQuery({
    queryKey: ['gsm-spans'],
    queryFn: () => gatewayApi.gsmSpans() as Promise<GsmSpan[]>,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const error = rawError ? (rawError as Error).message : null;

  const updateMutation = useMutation({
    mutationFn: async ({ gsmSpan, updates }: { gsmSpan: number; updates: { name?: string | null; phone_number?: string | null } }) => {
      const result = await gatewayApi.updateGsmSpan(gsmSpan, updates);
      if (!result.success) throw new Error(result.error || 'Failed to update GSM span');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gsm-spans'] }),
  });

  const updateGsmSpan = async (gsmSpan: number, updates: { name?: string | null; phone_number?: string | null }) => {
    await updateMutation.mutateAsync({ gsmSpan, updates });
  };

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['gsm-spans'] });

  return { gsmSpans, loading, error, updateGsmSpan, refetch };
}
