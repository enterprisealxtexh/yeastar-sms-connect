import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Settings, Save, Loader2 } from "lucide-react";
import { apiClient } from "@/integrations/supabase/api-client";
import { toast } from "@/hooks/use-toast";
import { GatewaySettingsForm } from "./GatewaySettingsForm";
import { PbxSettingsForm } from "./PbxSettingsForm";
import { TelegramSettingsForm } from "./TelegramSettingsForm";
import { LocalAgentGuide } from "./LocalAgentGuide";

interface SimPortConfig {
  id: string;
  port_number: number;
  extension: string | null;
  label: string | null;
  enabled: boolean;
}

interface ConfigurationPanelProps {
  simPorts: SimPortConfig[];
  isLoading?: boolean;
  onConfigSaved?: () => void;
}

export const ConfigurationPanel = ({
  simPorts,
  isLoading = false,
  onConfigSaved,
}: ConfigurationPanelProps) => {
  const [isSaving, setIsSaving] = useState(false);
  const [localMappings, setLocalMappings] = useState<
    Record<number, { extension: string; label: string; enabled: boolean }>
  >({});

  // Initialize local state from props
  useEffect(() => {
    const mappings: Record<number, { extension: string; label: string; enabled: boolean }> = {};
    simPorts.forEach((port) => {
      mappings[port.port_number] = {
        extension: port.extension || "",
        label: port.label || "",
        enabled: !!port.enabled,
      };
    });
    setLocalMappings(mappings);
  }, [simPorts]);

  const updateMapping = (
    portNumber: number,
    field: "extension" | "label" | "enabled",
    value: string | boolean
  ) => {
    setLocalMappings((prev) => ({
      ...prev,
      [portNumber]: {
        ...prev[portNumber],
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Update each SIM port configuration - Use local API instead of Supabase client
      const updates = simPorts.map((port) => {
        const mapping = localMappings[port.port_number];
        return fetch(`http://localhost:2003/api/port-status/${port.port_number}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            extension: mapping?.extension?.trim() || null,
            label: mapping?.label?.trim() || null,
            enabled: mapping?.enabled ?? true,
          })
        });
      });

      const results = await Promise.all(updates);
      const failures = results.filter((r) => !r.ok);

      if (failures.length > 0) {
        throw new Error("Failed to save some port configurations. Please try again.");
      }

      // Log the configuration change locally
      await fetch('http://localhost:2003/api/activity-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: "config_update",
          message: "SIM port configuration updated",
          severity: "info",
          metadata: { updated_ports: Object.keys(localMappings).map(Number) },
        })
      }).catch(err => console.error("Failed to log activity:", err));

      toast({
        title: "Configuration saved",
        description: "SIM port mappings have been updated successfully.",
      });

      if (onConfigSaved) onConfigSaved();
    } catch (error) {
      toast({
        title: "Error saving configuration",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="card-glow border-border/50 bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Settings className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-base font-semibold">Configuration</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-glow border-border/50 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Settings className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-base font-semibold">Configuration</CardTitle>
          </div>
          <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label className="text-muted-foreground">SIM Port Configuration</Label>
          <div className="grid gap-4 sm:grid-cols-2">
            {simPorts.map((port) => {
              const mapping = localMappings[port.port_number] || {
                extension: "",
                label: "",
                enabled: true,
              };
              return (
                <div
                  key={port.id}
                  className="p-4 rounded-lg bg-muted/30 border border-border/30 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center justify-center w-8 h-8 rounded bg-primary/10 text-primary font-mono text-sm font-semibold">
                        {port.port_number}
                      </span>
                      <span className="text-sm font-medium">SIM Port {port.port_number}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`enabled-${port.port_number}`} className="text-xs text-muted-foreground">
                        Enabled
                      </Label>
                      <Switch
                        id={`enabled-${port.port_number}`}
                        checked={mapping.enabled}
                        onCheckedChange={(checked) =>
                          updateMapping(port.port_number, "enabled", checked)
                        }
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label
                        htmlFor={`ext-${port.port_number}`}
                        className="text-xs text-muted-foreground"
                      >
                        Extension
                      </Label>
                      <Input
                        id={`ext-${port.port_number}`}
                        value={mapping.extension}
                        onChange={(e) =>
                          updateMapping(port.port_number, "extension", e.target.value)
                        }
                        className="font-mono text-sm h-8 bg-muted/50 border-border/50"
                        placeholder="e.g., 101"
                        maxLength={10}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor={`label-${port.port_number}`}
                        className="text-xs text-muted-foreground"
                      >
                        Label
                      </Label>
                      <Input
                        id={`label-${port.port_number}`}
                        value={mapping.label}
                        onChange={(e) =>
                          updateMapping(port.port_number, "label", e.target.value)
                        }
                        className="text-sm h-8 bg-muted/50 border-border/50"
                        placeholder="e.g., Sales Line"
                        maxLength={50}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Separator className="my-4" />

        <GatewaySettingsForm />

        <Separator className="my-4" />

        <PbxSettingsForm />

        <Separator className="my-4" />

        <TelegramSettingsForm />

        <Separator className="my-4" />

        <div className="space-y-3">
          <Label className="text-muted-foreground">Local Network Integration</Label>
          <div className="p-4 rounded-lg bg-muted/30 border border-border/30">
            <p className="text-sm text-muted-foreground mb-3">
              Since your TG400 is on a private network, use a local agent to sync SMS messages.
            </p>
            <LocalAgentGuide />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
