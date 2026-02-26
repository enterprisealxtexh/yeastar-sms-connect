import { useState, useEffect } from 'react';

interface GsmSpan {
  gsm_span: number;
  name: string | null;
  phone_number: string | null;
  is_active: number;
  signal_strength: number;
  carrier: string | null;
  last_active_check: string | null;
}

interface UpdateGsmSpanPayload {
  name?: string | null;
  phone_number?: string | null;
}

export function useGsmSpanConfig() {
  const [gsmSpans, setGsmSpans] = useState<GsmSpan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGsmSpans();
  }, []);

  const fetchGsmSpans = async () => {
    try {
      setLoading(true);
      setError(null);
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/gsm-spans`);
      if (!response.ok) {
        throw new Error(`Failed to fetch GSM spans: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        setGsmSpans(data.data);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error('Error fetching GSM spans:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateGsmSpan = async (gsmSpan: number, updates: UpdateGsmSpanPayload) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/gsm-spans/${gsmSpan}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        throw new Error(`Failed to update GSM span: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success) {
        // Refetch to get updated data
        await fetchGsmSpans();
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Error updating GSM span:', err);
      throw new Error(message);
    }
  };

  return { gsmSpans, loading, error, updateGsmSpan, refetch: fetchGsmSpans };
}
