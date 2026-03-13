import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, Loader2, Phone, FileText, Mail } from "lucide-react";
import { toast } from "sonner";
import { TemplateModal } from "./TemplateModal";

interface TelegramConfig {
  enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  notify_missed_calls: boolean;
  notify_new_sms: boolean;
  notify_system_errors: boolean;
  notify_shift_changes: boolean;
  daily_report_enabled: boolean;
  daily_report_time: string;
}

export const TelegramSettingsForm = () => {
  const [config, setConfig] = useState<TelegramConfig>({
    enabled: false,
    email_enabled: false,
    sms_enabled: true,
    notify_missed_calls: true,
    notify_new_sms: false,
    notify_system_errors: true,
    notify_shift_changes: true,
    daily_report_enabled: false,
    daily_report_time: "18:00",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL;
        const tgRes = await fetch(`${apiUrl}/api/telegram-config`);

        if (tgRes.ok) {
          const { data } = await tgRes.json();
          if (data) {
            setConfig({
              enabled: !!data.enabled,
              email_enabled: !!data.email_enabled,
              sms_enabled: data.sms_enabled === undefined ? true : !!data.sms_enabled,
              notify_missed_calls: data.notify_missed_calls === undefined ? true : !!data.notify_missed_calls,
              notify_new_sms: !!data.notify_new_sms,
              notify_system_errors: data.notify_system_errors === undefined ? true : !!data.notify_system_errors,
              notify_shift_changes: data.notify_shift_changes === undefined ? true : !!data.notify_shift_changes,
              daily_report_enabled: !!data.daily_report_enabled,
              daily_report_time: data.daily_report_time || "18:00",
            });
          }
        }
      } catch (error) {
        console.error("Error loading config:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadConfig();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/telegram-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!response.ok) throw new Error("Failed to save configuration");
      const result = await response.json();
      if (result.success) {
        toast.success("Notification settings saved");
      } else {
        throw new Error(result.message || "Failed to save configuration");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateManualReport = async () => {
    setIsGeneratingReport(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/manual-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const result = await response.json();
      if (response.ok && result.success) {
        toast.success(
          `✓ Report sent via SMS to ${result.sendResults?.sms?.count || 0} recipient${result.sendResults?.sms?.count !== 1 ? "s" : ""}`
        );
      } else {
        toast.error(result.error || "Failed to generate manual report");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate manual report");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Notification Channels - Email, SMS, Telegram */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Notification Channels</CardTitle>
          <CardDescription>Enable or disable delivery channels (configured in Setup tab)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs defaultValue="email" className="space-y-4">
            <TabsList className="w-full bg-card border border-border/50">
              <TabsTrigger value="email" className="flex-1 gap-2">
                <Mail className="w-4 h-4" />
                Email
              </TabsTrigger>
              <TabsTrigger value="sms" className="flex-1 gap-2">
                <Phone className="w-4 h-4" />
                SMS
              </TabsTrigger>
              <TabsTrigger value="telegram" className="flex-1 gap-2">
                <Send className="w-4 h-4" />
                Telegram
              </TabsTrigger>
            </TabsList>

            {/* Email Tab */}
            <TabsContent value="email" className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-medium">Enable Email Notifications</p>
                  <p className="text-xs text-muted-foreground">Deliver alerts to configured email recipients</p>
                </div>
                <Switch
                  checked={config.email_enabled}
                  onCheckedChange={(checked) => setConfig({ ...config, email_enabled: checked })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Configure SMTP credentials and email recipients in the <strong>Setup</strong> tab.
              </p>
            </TabsContent>

            {/* SMS Tab */}
            <TabsContent value="sms" className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-medium">Enable SMS Notifications</p>
                  <p className="text-xs text-muted-foreground">Send reports to configured phone numbers</p>
                </div>
                <Switch
                  checked={config.sms_enabled}
                  onCheckedChange={(checked) => setConfig({ ...config, sms_enabled: checked })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Configure phone number recipients in the <strong>Setup</strong> tab.
              </p>
            </TabsContent>

            {/* Telegram Tab */}
            <TabsContent value="telegram" className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-medium">Enable Telegram Notifications</p>
                  <p className="text-xs text-muted-foreground">Send alerts to Telegram bot</p>
                </div>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Configure Telegram bot token and chat ID in the <strong>Setup</strong> tab.
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Notification Events */}
      <Card className="border-border/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Notification Events</CardTitle>
          <CardDescription className="text-xs">
            Choose which events trigger alerts across all enabled channels
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Missed Calls</Label>
            <Switch
              checked={config.notify_missed_calls}
              onCheckedChange={(checked) => setConfig({ ...config, notify_missed_calls: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">New SMS Messages</Label>
            <Switch
              checked={config.notify_new_sms}
              onCheckedChange={(checked) => setConfig({ ...config, notify_new_sms: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">System Errors</Label>
            <Switch
              checked={config.notify_system_errors}
              onCheckedChange={(checked) => setConfig({ ...config, notify_system_errors: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Shift Changes</Label>
            <Switch
              checked={config.notify_shift_changes}
              onCheckedChange={(checked) => setConfig({ ...config, notify_shift_changes: checked })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Daily Report */}
      <Card className="border-border/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Daily Report</CardTitle>
          <CardDescription className="text-xs">
            Automated daily performance summary (Nairobi time)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enable Daily Report</Label>
            <Switch
              checked={config.daily_report_enabled}
              onCheckedChange={(checked) =>
                setConfig({ ...config, daily_report_enabled: checked })
              }
            />
          </div>
          {config.daily_report_enabled && (
            <div className="space-y-2">
              <Label htmlFor="daily-report-time" className="text-xs text-muted-foreground">
                Send Time (Nairobi)
              </Label>
              <Input
                id="daily-report-time"
                type="time"
                value={config.daily_report_time}
                onChange={(e) => setConfig({ ...config, daily_report_time: e.target.value })}
                className="w-40"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            onClick={handleGenerateManualReport}
            disabled={isGeneratingReport || !config.sms_enabled}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            {isGeneratingReport ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            {isGeneratingReport ? "Generating..." : "Generate Report Now"}
          </Button>
          <TemplateModal />
        </div>
        <Button onClick={handleSave} disabled={isSaving} size="sm" className="gap-2">
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {isSaving ? "Saving..." : "Save Alert Settings"}
        </Button>
      </div>
    </div>
  );
};
