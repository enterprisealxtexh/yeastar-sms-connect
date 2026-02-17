import { useState, useCallback, useEffect } from 'react';

export function useCallLogsStored() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(50);

  const fetchLogs = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: (page * limit).toString(),
        ...filters
      });

      const response = await fetch(`/api/call-logs/stored?${params}`);
      const data = await response.json();

      if (data.success) {
        setLogs(data.data.records || []);
        setTotal(data.data.total || 0);
      } else {
        setError(data.error || 'Failed to fetch call logs');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  const syncLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/call-logs/sync', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        // Refresh the logs after sync
        await fetchLogs();
        return data.data;
      } else {
        setError(data.error || 'Failed to sync logs');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchLogs]);

  const filterByDirection = useCallback((direction) => {
    setPage(0);
    fetchLogs({ direction });
  }, [fetchLogs]);

  const filterByStatus = useCallback((status) => {
    setPage(0);
    fetchLogs({ status });
  }, [fetchLogs]);

  const filterByExtension = useCallback((extension) => {
    setPage(0);
    fetchLogs({ extension });
  }, [fetchLogs]);

  useEffect(() => {
    fetchLogs();
  }, []);

  return {
    logs,
    loading,
    error,
    total,
    page,
    limit,
    setPage,
    setLimit,
    fetchLogs,
    syncLogs,
    filterByDirection,
    filterByStatus,
    filterByExtension
  };
}
