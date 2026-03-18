import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Save, Phone, Database, Wifi } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, apiCall } from "@/lib/api-client";

interface GsmSpan {
  gsm_span: number;
  name?: string;
  phone_number?: string;
  signal_strength?: number;
  is_active?: number;
  carrier?: string;
  last_active_check?: string;
}

export const SimPortSettingsForm = () => {
  const [gsmSpans, setGsmSpans] = useState<GsmSpan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingNames, setEditingNames] = useState<Record<number, { name: string; phone: string }>>({})

  useEffect(() => {
    loadGsmSpans();
  }, []);

  const loadGsmSpans = async () => {
    try {
      setLoading(true);
      // apiFetch already extracts .data — returns the array directly
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
      console.error("Failed to load GSM spans:", error);
      toast.error(error instanceof Error ? error.message : "Unknown error");
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
        // Reload to get updated data
        await loadGsmSpans();
      } else {
        throw new Error(data.error || "Failed to save configuration");
      }
    } catch (error) {
      console.error("Failed to save configuration:", error);
      toast.error(error instanceof Error ? error.message : "Unknown error");
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
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground mb-4">
        Configure port names and phone numbers for each GSM span. Active status is automatically checked every 12 hours.
      </div>

      <div className="grid gap-4">
        {gsmSpans.map((span) => {
          const portNumber = span.gsm_span - 1; // Convert to user-friendly port (0-3 → displays as Port 1-4)
          const displayPort = portNumber + 1; // Display as 1-4
          return (
            <Card key={span.gsm_span} className="p-4 border border-border/50 bg-card">
              <div className="space-y-3">
                {/* Port Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className={`w-4 h-4 ${
                      span.is_active ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                    }`} />
                    <span className="font-semibold text-sm">Port {displayPort}</span>
                    <span className="text-xs text-gray-500">(GsmSpan {span.gsm_span})</span>
                    
                    {/* Active Status Badge */}
                    <span className={`text-xs px-2 py-1 rounded font-medium ${
                      span.is_active
                        ? "bg-green-500/20 text-green-700 dark:text-green-300"
                        : "bg-gray-500/20 text-gray-700 dark:text-gray-300"
                    }`}>
                      {span.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>

                  {/* Signal & Carrier */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {span.signal_strength > 0 && (
                      <span className="flex items-center gap-1">
                        <Wifi className="w-3 h-3" />
                        {span.signal_strength}%
                      </span>
                    )}
                    {span.carrier && (
                      <span>{span.carrier}</span>
                    )}
                  </div>
                </div>

                {/* Port Name Input */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Port Name</label>
                  <Input
                    placeholder="e.g., Main Line, Vodafone, Airtel"
                    value={editingNames[span.gsm_span]?.name || ''}
                    onChange={(e) => handleNameChange(span.gsm_span, 'name', e.target.value)}
                    className="text-sm"
                    disabled={saving}
                  />
                </div>

                {/* Phone Number Input */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    Phone Number
                  </label>
                  <Input
                    placeholder="e.g., +254701234567"
                    value={editingNames[span.gsm_span]?.phone || ''}
                    onChange={(e) => handleNameChange(span.gsm_span, 'phone', e.target.value)}
                    className="text-sm"
                    disabled={saving}
                  />
                </div>

                {/* Last Check Time */}
                {span.last_active_check && (
                  <div className="text-xs text-muted-foreground">
                    Last checked: {new Date(span.last_active_check).toLocaleString()}
                  </div>
                )}

                {/* Save Button */}
                <Button
                  size="sm"
                  onClick={() => handleSave(span.gsm_span)}
                  disabled={saving}
                  className="w-full gap-2"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Port {displayPort}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Button onClick={loadGsmSpans} variant="outline" className="w-full" disabled={loading}>
        <Loader2 className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : 'hidden'}`} />
        Refresh Ports
      </Button>

      <div className="p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
        <strong>Backend uses GsmSpan (2-5):</strong> Frontend displays as Port 1-4 for convenience. Active status automatically updated every 12 hours.
      </div>
    </div>
  );
};
