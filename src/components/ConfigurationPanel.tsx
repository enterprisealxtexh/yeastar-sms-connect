import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Save, Loader2, Zap, Bell, MessageSquare, Database, Phone, KeyRound, RefreshCw, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { GatewaySettingsForm } from "./GatewaySettingsForm";
import { PbxSettingsForm } from "./PbxSettingsForm";
import GsmSpanSettingsForm from "./GsmSpanSettingsForm";
import ExtensionsPanel from "./ExtensionsPanel";
import { AutoReplyPanel } from "./AutoReplyPanel";
import { CallAutoSmsPanel } from "./CallAutoSmsPanel";
import { SetupPanel } from "./SetupPanel";
import { AlertsPanel } from "./AlertsPanel";
import { SystemUpdatePanel } from "./SystemUpdatePanel";
import { useAuth } from "@/hooks/useAuth";
import { useSmsSettings } from "@/hooks/useSmsSettings";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ConfigurationPanelProps {
  isLoading?: boolean;
  onConfigSaved?: () => void;
}

export const ConfigurationPanel = ({
  isLoading = false,
  onConfigSaved,
}: ConfigurationPanelProps) => {
  const [isSaving, setIsSaving] = useState(false);
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";

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
        <Tabs defaultValue="setup" className="space-y-6">
          <TabsList className="bg-card border border-border/50">
            <TabsTrigger value="setup" className="gap-2">
              <KeyRound className="w-4 h-4" />
              Setup
            </TabsTrigger>
            <TabsTrigger value="connectivity" className="gap-2">
              <Zap className="w-4 h-4" />
              Connectivity
            </TabsTrigger>
            <TabsTrigger value="sim-ports" className="gap-2">
              <Database className="w-4 h-4" />
              SIM Ports
            </TabsTrigger>
            <TabsTrigger value="sms" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              SMS
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-2">
              <Bell className="w-4 h-4" />
              Alerts
            </TabsTrigger>
            <TabsTrigger value="extensions" className="gap-2">
              <Phone className="w-4 h-4" />
              Extensions
            </TabsTrigger>
            {isSuperAdmin && (
              <TabsTrigger value="system" className="gap-2">
                <RefreshCw className="w-4 h-4" />
                System Update
              </TabsTrigger>
            )}
          </TabsList>

          {/* Setup Tab - Credentials & Recipients */}
          <TabsContent value="setup" className="space-y-6">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                  <KeyRound className="w-4 h-4" />
                  Channel Setup
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Configure Telegram bot credentials, email SMTP settings, and SMS recipient phone numbers
                </p>
              </div>
              <SetupPanel />
            </div>
          </TabsContent>

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

          {/* SMS Tab - Auto-Reply and Call Auto-SMS */}
          <TabsContent value="sms" className="space-y-6">
            <SmsTabContent isSuperAdmin={isSuperAdmin} />
          </TabsContent>

          {/* Alerts Tab - Reports, Logs, Errors, Notification Settings */}
          <TabsContent value="alerts" className="space-y-6">
            <AlertsPanel />
          </TabsContent>

          <TabsContent value="extensions" className="space-y-6">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  PBX Extensions
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Manage synced PBX extensions and review their recent activity
                </p>
              </div>
              <ExtensionsPanel />
            </div>
          </TabsContent>

          {isSuperAdmin && (
            <TabsContent value="system" className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    System Update
                  </h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Pull latest backend-configured release and rebuild
                  </p>
                </div>
                <SystemUpdatePanel />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
};

// SMS Tab Content Component
function SmsTabContent({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { smsEnabled, isLoading, isMutating, toggleSms } = useSmsSettings();

  const handleToggle = async () => {
    try {
      await toggleSms(!smsEnabled);
      toast({
        title: smsEnabled ? "SMS Disabled" : "SMS Enabled",
        description: smsEnabled 
          ? "SMS sending has been disabled for all users" 
          : "SMS sending has been enabled for all users",
      });
    } catch (error) {
      toast({
        title: "Error updating SMS settings",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {isSuperAdmin && (
        <>
          <div className="border border-border/50 rounded-lg p-4 bg-card/50">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Outbound SMS Gateway
                </h3>
                <p className="text-xs text-muted-foreground">
                  Master switch for ALL outbound SMS via the Nosteq gateway — auto-reply, missed-call SMS, notification alerts, and daily reports. When disabled, nothing gets sent.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <span className={`text-sm font-medium px-3 py-1 rounded-full ${
                      smsEnabled 
                        ? 'bg-green-500/10 text-green-600' 
                        : 'bg-red-500/10 text-red-600'
                    }`}>
                      {smsEnabled ? '✓ Enabled' : '✗ Disabled'}
                    </span>
                    <Button
                      size="sm"
                      variant={smsEnabled ? "default" : "outline"}
                      onClick={handleToggle}
                      disabled={isMutating || isLoading}
                      className="ml-2"
                    >
                      {isMutating ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : null}
                      {!smsEnabled ? 'Enable SMS' : 'Disable SMS'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          {!smsEnabled && (
            <Alert className="border-red-500/50 bg-red-500/5">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-700">
                Outbound SMS is globally off. No SMS will leave the system — auto-reply, missed-call SMS, notification alerts, and daily reports are all blocked until re-enabled.
              </AlertDescription>
            </Alert>
          )}

          <Separator />
        </>
      )}

      <div className="space-y-6">
        <div>
          <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            SMS Automation
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Configure automatic SMS replies and post-call messages
          </p>
        </div>
        <AutoReplyPanel />
        <CallAutoSmsPanel />
      </div>
    </div>
  );
}
