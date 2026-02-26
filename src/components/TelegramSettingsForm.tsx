import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Send, Loader2, AlertCircle, CheckCircle, Trash2, Phone, FileText, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

interface TelegramConfig {
  bot_token: string;
  chat_id: string;
  enabled: boolean;
}

interface SmsRecipient {
  id: string;
  phone_number: string;
  is_active: boolean;
}

export const TelegramSettingsForm = () => {
  const [config, setConfig] = useState<TelegramConfig>({
    bot_token: "",
    chat_id: "",
    enabled: false,
  });
  const [smsRecipients, setSmsRecipients] = useState<SmsRecipient[]>([]);
  const [newPhoneNumber, setNewPhoneNumber] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingPhone, setIsAddingPhone] = useState(false);
  const [isRemovingPhone, setIsRemovingPhone] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  // Load Telegram config and SMS recipients on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL;
        
        // Load Telegram config
        const tgResponse = await fetch(`${apiUrl}/api/telegram-config`);
        if (tgResponse.ok) {
          const result = await tgResponse.json();
          if (result.data) {
            setConfig({
              bot_token: result.data.bot_token || "",
              chat_id: result.data.chat_id || "",
              enabled: result.data.enabled || false,
            });
          }
        }

        // Load SMS recipients
        const smsResponse = await fetch(`${apiUrl}/api/sms-report-recipients`);
        if (smsResponse.ok) {
          const result = await smsResponse.json();
          if (result.data) {
            setSmsRecipients(result.data);
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

  const handleAddPhone = async () => {
    if (!newPhoneNumber.trim()) {
      toast.error("Please enter a phone number");
      return;
    }

    // Auto-format phone number: convert 0708588464 to 254708588464
    let formattedPhone = newPhoneNumber.trim();
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "254" + formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith("254")) {
      // If it doesn't start with 0 or 254, add 254
      formattedPhone = "254" + formattedPhone;
    }

    setIsAddingPhone(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/sms-report-recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: formattedPhone }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast.success(`Phone number ${formattedPhone} added`);
        setNewPhoneNumber("");
        // Reload recipients
        const recipientsResponse = await fetch(`${apiUrl}/api/sms-report-recipients`);
        if (recipientsResponse.ok) {
          const data = await recipientsResponse.json();
          setSmsRecipients(data.data || []);
        }
      } else {
        toast.error(result.error || "Failed to add phone number");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add phone number";
      toast.error(message);
    } finally {
      setIsAddingPhone(false);
    }
  };

  const handleRemovePhone = async (phoneNumber: string) => {
    if (!confirm(`Remove ${phoneNumber} from SMS report recipients?`)) {
      return;
    }

    setIsRemovingPhone(phoneNumber);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/sms-report-recipients/${encodeURIComponent(phoneNumber)}`, {
        method: "DELETE",
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast.success(`Phone number removed`);
        // Reload recipients
        const recipientsResponse = await fetch(`${apiUrl}/api/sms-report-recipients`);
        if (recipientsResponse.ok) {
          const data = await recipientsResponse.json();
          setSmsRecipients(data.data || []);
        }
      } else {
        toast.error(result.error || "Failed to remove phone number");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove phone number";
      toast.error(message);
    } finally {
      setIsRemovingPhone(null);
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
        const successMsg = `✓ Report sent via SMS to ${result.sendResults?.sms?.count || 0} recipient${result.sendResults?.sms?.count !== 1 ? 's' : ''}`;
        toast.success(successMsg);
      } else {
        toast.error(result.error || "Failed to generate manual report");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate manual report";
      toast.error(message);
    } finally {
      setIsGeneratingReport(false);
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
    <div className="space-y-3">
      {/* Telegram Configuration Card */}
      <Card className="card-glow border-border/50 bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                <Send className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">Telegram Reports</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Receive daily reports and system notifications
                </CardDescription>
              </div>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border/30">
            <div>
              <Label htmlFor="bot-token" className="text-sm font-medium">
                Bot Token <span className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Get from <code className="bg-muted px-1.5 py-0.5 rounded">@BotFather</code>
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
                Send a message to your bot, check updates endpoint
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
                <AlertDescription className="text-xs">{testResult.message}</AlertDescription>
              </div>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleTestConnection}
              disabled={isTesting || !config.bot_token || !config.chat_id}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              {isTesting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Test Connection
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              size="sm"
              className="gap-2"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* SMS Recipients Card */}
      <Card className="card-glow border-border/50 bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-500/10">
              <Phone className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">SMS Reports</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Send reports to phone numbers
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="tel"
              placeholder="e.g., 0712345678"
              value={newPhoneNumber}
              onChange={(e) => setNewPhoneNumber(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleAddPhone()}
              className="font-mono text-sm h-9 bg-background/50 border-border/50 flex-1"
            />
            <Button
              onClick={handleAddPhone}
              disabled={isAddingPhone || !newPhoneNumber.trim()}
              size="sm"
              className="gap-2"
            >
              {isAddingPhone ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Add
            </Button>
          </div>

          {smsRecipients.length > 0 && (
            <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-border/30">
              {smsRecipients.map((recipient) => (
                <div
                  key={recipient.id}
                  className="flex items-center justify-between p-2 rounded bg-background/50 text-xs"
                >
                  <span className="font-mono">{recipient.phone_number}</span>
                  <Button
                    onClick={() => handleRemovePhone(recipient.phone_number)}
                    disabled={isRemovingPhone === recipient.phone_number}
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                  >
                    {isRemovingPhone === recipient.phone_number ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3 text-destructive" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button
            onClick={handleGenerateManualReport}
            disabled={isGeneratingReport}
            variant="outline"
            size="sm"
            className="w-full gap-2"
          >
            {isGeneratingReport ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            {isGeneratingReport ? "Generating..." : "Generate Report Now"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
