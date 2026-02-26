import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Save, Loader2, Zap, Bell, MessageSquare, Database } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { GatewaySettingsForm } from "./GatewaySettingsForm";
import { PbxSettingsForm } from "./PbxSettingsForm";
import { TelegramSettingsForm } from "./TelegramSettingsForm";
import GsmSpanSettingsForm from "./GsmSpanSettingsForm";

interface ConfigurationPanelProps {
  isLoading?: boolean;
  onConfigSaved?: () => void;
}

export const ConfigurationPanel = ({
  isLoading = false,
  onConfigSaved,
}: ConfigurationPanelProps) => {
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Log the configuration change locally
      const apiUrl = import.meta.env.VITE_API_URL;
      await fetch(`${apiUrl}/api/activity-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: "config_update",
          message: "System configuration updated",
          severity: "info",
        })
      }).catch(err => console.error("Failed to log activity:", err));

      toast({
        title: "Configuration saved",
        description: "System configuration has been updated successfully.",
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
        <Tabs defaultValue="connectivity" className="space-y-6">
          <TabsList className="bg-card border border-border/50">
            <TabsTrigger value="connectivity" className="gap-2">
              <Zap className="w-4 h-4" />
              Connectivity
            </TabsTrigger>
            <TabsTrigger value="sim-ports" className="gap-2">
              <Database className="w-4 h-4" />
              SIM Ports
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-2">
              <Bell className="w-4 h-4" />
              Alerts & SMS
            </TabsTrigger>
          </TabsList>

          {/* Connectivity Tab - Gateway + PBX */}
          <TabsContent value="connectivity" className="space-y-6">
            <div className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    SMS Gateway (TG400)
                  </h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Configure TG400 SMS gateway connection
                  </p>
                </div>
                <GatewaySettingsForm />
              </div>
              <Separator />
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    PBX System (S100)
                  </h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Configure your Yeastar S100 PBX system connection
                  </p>
                </div>
                <PbxSettingsForm />
              </div>
            </div>
          </TabsContent>

          {/* SIM Ports Tab */}
          <TabsContent value="sim-ports" className="space-y-6">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  Active SIM Ports
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Name your SIM ports for easier identification of which card serves which group
                </p>
              </div>
              <GsmSpanSettingsForm />
            </div>
          </TabsContent>

          {/* Alerts & SMS Tab - Telegram Notifications */}
          <TabsContent value="alerts" className="space-y-6">
            <div className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    Telegram Notifications
                  </h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Setup Telegram bot for instant alerts
                  </p>
                </div>
                <TelegramSettingsForm />
              </div>
              <Separator />
              <div className="space-y-4">

              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
