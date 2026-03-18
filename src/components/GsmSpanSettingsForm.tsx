import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, apiCall } from '@/lib/api-client';

interface GsmSpan {
  gsm_span: number;
  name: string | null;
  phone_number: string | null;
  is_active: number;
}

export default function GsmSpanSettingsForm() {
  const queryClient = useQueryClient();
  const [gsmSpans, setGsmSpans] = useState<GsmSpan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingNames, setEditingNames] = useState<Record<number, { name: string; phone: string }>>({});

  useEffect(() => {
    loadGsmSpans();
  }, []);

  const loadGsmSpans = async () => {
    try {
      setLoading(true);
      // apiFetch already extracts .data from the API response — returns the array directly
      const spans = await apiFetch<GsmSpan[]>('/api/gsm-spans');

      if (Array.isArray(spans)) {
        setGsmSpans(spans);
        const names: Record<number, { name: string; phone: string }> = {};
        spans.forEach((span: GsmSpan) => {
          names[span.gsm_span] = {
            name: span.name || '',
            phone: span.phone_number || ''
          };
        });
        setEditingNames(names);
      }
    } catch (error) {
      console.error('Failed to load GSM spans:', error);
      toast.error(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const refreshActiveSpans = async () => {
    try {
      setLoading(true);
      // Call the manual check endpoint to query TG400 hardware directly
      const data = await apiCall('/api/check-gsm-spans', { method: 'POST' });

      if (data.success && Array.isArray(data.data)) {
        setGsmSpans(data.data);
        const names: Record<number, { name: string; phone: string }> = {};
        (data.data as GsmSpan[]).forEach((span) => {
          names[span.gsm_span] = {
            name: span.name || '',
            phone: span.phone_number || ''
          };
        });
        setEditingNames(names);
        
        const activeCount = (data.data as GsmSpan[]).filter((s) => s.is_active === 1).length;
        toast.success(`${activeCount} active SIM port(s) detected`);
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      }
    } catch (error) {
      console.error('Failed to check GSM spans:', error);
      toast.error(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleNameChange = (gsmSpan: number, field: 'name' | 'phone', value: string) => {
    setEditingNames(prev => ({
      ...prev,
      [gsmSpan]: {
        ...prev[gsmSpan],
        [field]: value
      }
    }));
  };

  const handleSave = async (gsmSpan: number) => {
    try {
      setSaving(true);
      const values = editingNames[gsmSpan];

      const data = await apiCall(`/api/gsm-spans/${gsmSpan}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: values.name.trim() || null,
          phone_number: values.phone.trim() || null
        })
      });

      if (data.success) {
        const portNumber = gsmSpan - 1;
        toast.success(`Port ${portNumber} configuration has been updated.`);
        await loadGsmSpans();
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      } else {
        throw new Error(data.error || 'Failed to save configuration');
      }
    } catch (error) {
      console.error('Failed to save configuration:', error);
      toast.error(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!gsmSpans || gsmSpans.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">No SIM ports configured</p>
        <Button onClick={loadGsmSpans} className="mt-4" disabled={loading}>
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Configure SIM ports in a compact layout for faster updates.
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {gsmSpans.map((span) => {
          const portNumber = span.gsm_span - 1;
          const isActive = span.is_active === 1;
          
          return (
            <div key={span.gsm_span} className="rounded-lg border border-border/50 bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-xs font-semibold text-primary">
                    {portNumber}
                  </span>
                  <span className="text-sm font-semibold">Port {portNumber}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                    isActive
                      ? 'bg-green-500/20 text-green-700 dark:text-green-300'
                      : 'bg-red-500/20 text-red-700 dark:text-red-300'
                  }`}>
                    {isActive ? 'Active' : 'Inactive'}
                  </span>

                  <Button
                    size="sm"
                    onClick={() => handleSave(span.gsm_span)}
                    disabled={!isActive || saving}
                    className="h-7 px-2"
                    variant={isActive ? "default" : "ghost"}
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder={isActive ? 'Extension / label' : 'Port label'}
                  value={editingNames[span.gsm_span]?.name || ''}
                  onChange={(e) => handleNameChange(span.gsm_span, 'name', e.target.value)}
                  className="h-8 text-sm"
                  disabled={!isActive || saving}
                />

                <Input
                  placeholder={`SIM ${portNumber}`}
                  value={editingNames[span.gsm_span]?.phone || ''}
                  onChange={(e) => handleNameChange(span.gsm_span, 'phone', e.target.value)}
                  className="h-8 text-sm"
                  disabled={!isActive || saving}
                />
              </div>
            </div>
          );
        })}
      </div>

      <Button onClick={refreshActiveSpans} variant="outline" className="h-8 w-full text-xs" disabled={loading}>
        <Loader2 className={`mr-2 h-3 w-3 ${loading ? 'animate-spin' : 'hidden'}`} />
        Refresh Ports
      </Button>
    </div>
  );
}
