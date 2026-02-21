import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Save, Wifi, Phone, Database } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface SimPort {
  port: number;
  portNumber: number;
  label?: string;
  phone_number?: string;
  signal_strength?: number;
  status?: string;
  isUp?: boolean;
}

export const SimPortSettingsForm = () => {
  const [ports, setPorts] = useState<SimPort[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingLabels, setEditingLabels] = useState<Record<number, string>>({});
  const apiUrl = import.meta.env.VITE_API_URL;

  useEffect(() => {
    loadPorts();
  }, []);

  const loadPorts = async () => {
    try {
      setLoading(true);
      // Get all ports from TG400 (merged with database config)
      // API already returns internal port numbers (1-4), not TG400 ports (2-5)
      const response = await fetch(`${apiUrl}/api/tg400-ports`);
      const data = await response.json();
      
      if (data.success && data.data) {
        setPorts(data.data);
        // Initialize editing labels using port numbers returned by API (already internal 1-4)
        const labels: Record<number, string> = {};
        data.data.forEach((port: SimPort) => {
          labels[port.portNumber] = port.label || '';  // API already returns internal port
        });
        setEditingLabels(labels);
      }
    } catch (error) {
      console.error("Failed to load ports:", error);
      toast({
        title: "Failed to load SIM ports",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLabelChange = (internalPortNumber: number, label: string) => {
    setEditingLabels(prev => ({
      ...prev,
      [internalPortNumber]: label
    }));
  };

  const handleSaveLabel = async (internalPortNumber: number) => {
    try {
      setSaving(true);
      
      const response = await fetch(`${apiUrl}/api/sim-port/${internalPortNumber}/label`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editingLabels[internalPortNumber] })
      });

      const data = await response.json();
      if (data.success) {
        toast({
          title: "Port label saved",
          description: `Port ${internalPortNumber + 1} label has been updated.`,
        });
        // Reload ports to get updated data
        await loadPorts();
      } else {
        throw new Error(data.error || "Failed to save label");
      }
    } catch (error) {
      console.error("Failed to save label:", error);
      toast({
        title: "Failed to save port label",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
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

  if (!ports || ports.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">No active SIM ports found</p>
        <Button onClick={loadPorts} className="mt-4" disabled={loading}>
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground mb-4">
        Configure names for active SIM ports to easily identify which port is for which SMS group.
      </div>

      <div className="grid gap-4">
        {ports.map((port) => {
          // API already returns internal port numbers (1-4), no conversion needed
          const portNumber = port.portNumber;
          return (
          <Card key={portNumber} className="p-4 border border-border/50 bg-card">
            <div className="space-y-3">
              {/* Port Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className={`w-4 h-4 ${
                    port.isUp ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  }`} />
                  <span className="font-semibold text-sm">Port {portNumber}</span>
                  
                  {/* Status Badge - TG400 Hardware Status */}
                  <span className={`text-xs px-2 py-1 rounded font-medium ${
                    port.isUp
                      ? "bg-green-500/20 text-green-700 dark:text-green-300"
                      : "bg-red-500/20 text-red-700 dark:text-red-300"
                  }`}>
                    {port.isUp ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>

              {/* Port Details */}
              {port.phone_number && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Phone className="w-3 h-3" />
                  <span>{port.phone_number}</span>
                </div>
              )}

              {/* Label Input */}
              <div className="flex gap-2">
                <Input
                  placeholder="Enter port label (e.g., Vodafone Kenya, Group A)"
                  value={editingLabels[portNumber] || ''}
                  onChange={(e) => handleLabelChange(portNumber, e.target.value)}
                  className="flex-1 text-sm"
                  disabled={saving}
                />
                <Button
                  size="sm"
                  onClick={() => handleSaveLabel(portNumber)}
                  disabled={saving}
                  className="gap-2"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          </Card>
        );
        })}
      </div>

      <Button onClick={loadPorts} variant="outline" className="w-full" disabled={loading}>
        <Loader2 className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : 'hidden'}`} />
        Refresh Ports
      </Button>
    </div>
  );
};
