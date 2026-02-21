import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Send, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

interface TelegramConfig {
  bot_token: string;
  chat_id: string;
  enabled: boolean;
}

export const TelegramSettingsForm = () => {
  const [config, setConfig] = useState<TelegramConfig>({
    bot_token: "",
    chat_id: "",
    enabled: false,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Load Telegram config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL;
        const response = await fetch(`${apiUrl}/api/telegram-config`);
        if (response.ok) {
          const result = await response.json();
          if (result.data) {
            setConfig({
              bot_token: result.data.bot_token || "",
              chat_id: result.data.chat_id || "",
              enabled: result.data.enabled || false,
            });
          }
        }
      } catch (error) {
        console.error("Error loading Telegram config:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, []);

  const handleSave = async () => {
    if (!config.bot_token && config.enabled) {
      toast.error("Bot token is required when Telegram is enabled");
      return;
    }
    if (!config.chat_id && config.enabled) {
      toast.error("Chat ID is required when Telegram is enabled");
      return;
    }

    setIsSaving(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/telegram-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        throw new Error("Failed to save Telegram configuration");
      }

      const result = await response.json();
      if (result.success) {
        toast.success("Telegram configuration saved successfully");
        setTestResult(null);
      } else {
        throw new Error(result.message || "Failed to save configuration");
      }
    } catch (error) {
      console.error("Error saving Telegram config:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!config.bot_token) {
      setTestResult({ success: false, message: "Bot token is required" });
      return;
    }
    if (!config.chat_id) {
      setTestResult({ success: false, message: "Chat ID is required" });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/telegram-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          bot_token: config.bot_token,
          chat_id: config.chat_id,
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setTestResult({
          success: true,
          message: "Test message sent successfully to your Telegram chat!",
        });
        toast.success("Telegram connection test passed!");
      } else {
        setTestResult({
          success: false,
          message: result.error || result.message || "Failed to send test message",
        });
        toast.error("Telegram connection test failed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection test failed";
      setTestResult({ success: false, message });
      toast.error(message);
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="card-glow border-border/50 bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Send className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Telegram</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Configure Telegram bot for notifications
              </CardDescription>
            </div>
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
              <Send className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Telegram</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Configure Telegram bot for system notifications
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="telegram-enabled" className="text-xs text-muted-foreground">
              Enable
            </Label>
            <Switch
              id="telegram-enabled"
              checked={config.enabled}
              onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border/30">
          <div>
            <Label htmlFor="bot-token" className="text-sm font-medium">
              Bot Token <span className="text-destructive">*</span>
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              Get this from <code className="bg-muted px-1.5 py-0.5 rounded">@BotFather</code> on Telegram
            </p>
            <Input
              id="bot-token"
              type="password"
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              value={config.bot_token}
              onChange={(e) => setConfig({ ...config, bot_token: e.target.value })}
              className="font-mono text-sm h-9 bg-background/50 border-border/50"
            />
          </div>

          <div>
            <Label htmlFor="chat-id" className="text-sm font-medium">
              Chat ID <span className="text-destructive">*</span>
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              Send any message to your bot, then check <code className="bg-muted px-1.5 py-0.5 rounded">http://api.telegram.org/bot[TOKEN]/getUpdates</code>
            </p>
            <Input
              id="chat-id"
              type="text"
              placeholder="123456789"
              value={config.chat_id}
              onChange={(e) => setConfig({ ...config, chat_id: e.target.value })}
              className="font-mono text-sm h-9 bg-background/50 border-border/50"
            />
          </div>
        </div>

        {testResult && (
          <Alert variant={testResult.success ? "default" : "destructive"}>
            <div className="flex items-start gap-3">
              {testResult.success ? (
                <CheckCircle className="w-4 h-4 mt-0.5 text-green-500" />
              ) : (
                <AlertCircle className="w-4 h-4 mt-0.5" />
              )}
              <AlertDescription>{testResult.message}</AlertDescription>
            </div>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleTestConnection}
            disabled={isTesting || !config.bot_token || !config.chat_id}
            variant="outline"
            className="gap-2"
          >
            {isTesting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {isTesting ? "Testing..." : "Test Connection"}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="gap-2"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Save"
            )}
            {isSaving ? "Saving..." : "Save Settings"}
          </Button>
        </div>

        <Alert className="bg-blue-500/10 border-blue-500/30">
          <AlertCircle className="w-4 h-4 text-blue-500" />
          <AlertDescription className="text-xs text-blue-400 ml-2">
            Once enabled, you'll be able to send system reports and logs to your Telegram chat directly from the dashboard.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
