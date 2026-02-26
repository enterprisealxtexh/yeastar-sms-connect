import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Save } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

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
  const apiUrl = import.meta.env.VITE_API_URL;

  useEffect(() => {
    loadGsmSpans();
  }, []);

  const loadGsmSpans = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${apiUrl}/api/gsm-spans`);
      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        setGsmSpans(data.data);
        const names: Record<number, { name: string; phone: string }> = {};
        data.data.forEach((span: GsmSpan) => {
          names[span.gsm_span] = {
            name: span.name || '',
            phone: span.phone_number || ''
          };
        });
        setEditingNames(names);
      }
    } catch (error) {
      console.error('Failed to load GSM spans:', error);
      toast({
        title: 'Failed to load ports',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const refreshActiveSpans = async () => {
    try {
      setLoading(true);
      // Call the manual check endpoint to query TG400 hardware directly
      const response = await fetch(`${apiUrl}/api/check-gsm-spans`, {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        setGsmSpans(data.data);
        const names: Record<number, { name: string; phone: string }> = {};
        data.data.forEach((span: GsmSpan) => {
          names[span.gsm_span] = {
            name: span.name || '',
            phone: span.phone_number || ''
          };
        });
        setEditingNames(names);
        
        // Show toast with active count
        const activeCount = data.data.filter((s: GsmSpan) => s.is_active === 1).length;
        toast({
          title: 'Ports checked',
          description: `${activeCount} active SIM port(s) detected`,
        });
        
        // Invalidate dashboard stats cache to refresh the dashboard
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      }
    } catch (error) {
      console.error('Failed to check GSM spans:', error);
      toast({
        title: 'Failed to check ports',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
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

      const response = await fetch(`${apiUrl}/api/gsm-spans/${gsmSpan}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name.trim() || null,
          phone_number: values.phone.trim() || null
        })
      });

      const data = await response.json();
      if (data.success) {
        const portNumber = gsmSpan - 1;
        toast({
          title: 'Port saved',
          description: `Port ${portNumber} configuration has been updated.`,
        });
        await loadGsmSpans();
        // Invalidate dashboard stats cache to update port names in dashboard
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      } else {
        throw new Error(data.error || 'Failed to save configuration');
      }
    } catch (error) {
      console.error('Failed to save configuration:', error);
      toast({
        title: 'Failed to save port configuration',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
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
      <div className="text-sm text-muted-foreground">
        Configure names for your active SIM ports to easily identify which port is for which SMS group.
      </div>

      <div className="space-y-3">
        {gsmSpans.map((span) => {
          const portNumber = span.gsm_span - 1;
          const isActive = span.is_active === 1;
          
          return (
            <div key={span.gsm_span} className="bg-background p-4 rounded-lg border border-border/50">
              {/* Top Row: Port Label + Status Badge | Save Button */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold">Port {portNumber}</span>
                  <span className={`text-xs px-2.5 py-1 rounded font-semibold ${
                    isActive
                      ? 'bg-green-500/20 text-green-700 dark:text-green-300'
                      : 'bg-red-500/20 text-red-700 dark:text-red-300'
                  }`}>
                    {isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Save Button */}
                <Button
                  size="sm"
                  onClick={() => handleSave(span.gsm_span)}
                  disabled={!isActive || saving}
                  className="h-8 px-3 gap-1.5"
                  variant={isActive ? "default" : "ghost"}
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span className="text-xs font-medium">Save</span>
                </Button>
              </div>

              {/* Bottom Row: Port Name Input */}
              <Input
                placeholder={isActive ? 'Enter port name (e.g., Vodafone Kenya, Group A)' : 'Enter port label (e.g., Vodafone Kenya, Group A)'}
                value={editingNames[span.gsm_span]?.name || ''}
                onChange={(e) => handleNameChange(span.gsm_span, 'name', e.target.value)}
                className="h-9 text-sm"
                disabled={!isActive || saving}
              />
            </div>
          );
        })}
      </div>

      <Button onClick={refreshActiveSpans} variant="outline" className="w-full text-xs h-9 mt-4" disabled={loading}>
        <Loader2 className={`w-3 h-3 mr-2 ${loading ? 'animate-spin' : 'hidden'}`} />
        Refresh Ports
      </Button>
    </div>
  );
}
