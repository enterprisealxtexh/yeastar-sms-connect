import { useState, useCallback, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';

export interface CallLog {
  [key: string]: string | number;
}

export interface CallLogsData {
  inbound: {
    count: number;
    calls: CallLog[];
  };
  outbound: {
    count: number;
    calls: CallLog[];
  };
  total: number;
  allCalls: Array<CallLog & { type: 'inbound' | 'outbound' }>;
}

export const useCallLogs = () => {
  const [logs, setLogs] = useState<CallLogsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCallLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/pbx-call/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const data = await response.json();

      if (data.success) {
        setLogs(data.data);
      } else {
        setError(data.error || 'Failed to fetch call logs');
        toast({
          title: '❌ Error',
          description: data.error || 'Failed to fetch call logs',
          variant: 'destructive'
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch call logs';
      setError(errorMessage);
      toast({
        title: '❌ Error',
        description: errorMessage,
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-fetch on mount
  useEffect(() => {
    fetchCallLogs();
  }, [fetchCallLogs]);

  return {
    logs,
    isLoading,
    error,
    refetch: fetchCallLogs
  };
};
