import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Loader2, AlertCircle, CheckCircle, Trash2, Phone, Plus, Mail, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

interface SetupConfig {
  bot_token: string;
  chat_id: string;
  email_smtp_host: string;
  email_smtp_port: number;
  email_smtp_user: string;
  email_smtp_pass: string;
  email_from: string;
  email_recipients: string[];
  email_smtp_encryption: string;
}

interface SmsRecipient {
  id: string;
  phone_number: string;
  is_active: boolean;
}

export const SetupPanel = () => {
  const [config, setConfig] = useState<SetupConfig>({
    bot_token: "",
    chat_id: "",
    email_smtp_host: "",
    email_smtp_port: 587,
    email_smtp_user: "",
    email_smtp_pass: "",
    email_from: "",
    email_recipients: [],
    email_smtp_encryption: "auto",
  });
  const [smsRecipients, setSmsRecipients] = useState<SmsRecipient[]>([]);
  const [newPhoneNumber, setNewPhoneNumber] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isAddingPhone, setIsAddingPhone] = useState(false);
  const [isRemovingPhone, setIsRemovingPhone] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL;
        const [tgRes, smsRes] = await Promise.all([
          fetch(`${apiUrl}/api/channel-setup`),
          fetch(`${apiUrl}/api/sms-report-recipients`),
        ]);

        if (tgRes.ok) {
          const { data } = await tgRes.json();
          console.log('📋 [Setup] Loaded telegram config:', {
            bot_token: data?.bot_token ? '✓ set' : '✗ missing',
            chat_id: data?.chat_id ? '✓ set' : '✗ missing',
            email_smtp_host: data?.email_smtp_host ? `✓ ${data.email_smtp_host}` : '✗ missing',
            email_smtp_port: data?.email_smtp_port || 587,
            email_smtp_user: data?.email_smtp_user ? '✓ set' : '✗ missing',
            email_smtp_pass: data?.email_smtp_pass ? '✓ set' : '✗ missing',
            email_from: data?.email_from ? `✓ ${data.email_from}` : '✗ missing',
            email_recipients: data?.email_recipients ? `✓ ${JSON.stringify(data.email_recipients)}` : '✗ none',
          });
          if (data) {
            setHasUnsavedChanges(false);
            setConfig({
              bot_token: data.bot_token || "",
              chat_id: data.chat_id || "",
              email_smtp_host: data.email_smtp_host || "",
              email_smtp_port: data.email_smtp_port || 587,
              email_smtp_user: data.email_smtp_user || "",
              email_smtp_pass: data.email_smtp_pass || "",
              email_from: data.email_from || "",
              email_smtp_encryption: data.email_smtp_encryption || "auto",
              email_recipients: (() => {
                const raw = data.email_recipients;
                if (Array.isArray(raw)) return raw;
                if (typeof raw === "string") {
                  try {
                    const parsed = JSON.parse(raw);
                    return Array.isArray(parsed) ? parsed : [];
                  } catch {
                    return [];
                  }
                }
                return [];
              })(),
            });
          }
        }

        if (smsRes.ok) {
          const { data } = await smsRes.json();
          console.log('📱 [Setup] Loaded SMS recipients:', data?.length ? `✓ ${data.length} recipient(s)` : '✗ none', data);
          if (data) setSmsRecipients(data);
        }
      } catch (err) {
        console.error("Setup load error:", err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      // Load current full config first so we don't overwrite notification settings
      const res = await fetch(`${apiUrl}/api/channel-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error("Save failed");
      setHasUnsavedChanges(false);
      toast.success("Setup saved successfully");
      setTestResult(null);
      console.log('✅ [Setup] Configuration saved successfully');
    } catch (err) {
      console.error('❌ [Setup] Failed to save:', err);
      toast.error(err instanceof Error ? err.message : "Failed to save setup");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    if (!config.bot_token || !config.chat_id) {
      setTestResult({ success: false, message: "Bot token and Chat ID are required" });
      console.warn('⚠️  Telegram test skipped: missing credentials');
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      console.log('🧪 [Setup] Testing Telegram with token:', config.bot_token.substring(0, 10) + '...');
      const apiUrl = import.meta.env.VITE_API_URL;
      const res = await fetch(`${apiUrl}/api/telegram-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", bot_token: config.bot_token, chat_id: config.chat_id }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setTestResult({ success: true, message: "Test message sent to your Telegram chat!" });
        console.log('✅ [Setup] Telegram test passed');
        toast.success("Telegram connection test passed!");
      } else {
        setTestResult({ success: false, message: result.error || result.message || "Test failed" });
        console.warn('❌ [Setup] Telegram test failed:', result);
        toast.error("Telegram connection test failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection test failed";
      setTestResult({ success: false, message: msg });
      console.error('❌ [Setup] Telegram test exception:', err);
      toast.error(msg);
    } finally {
      setIsTesting(false);
    }
  };

  const handleAddEmail = () => {
    const email = newEmail.trim();
    if (!email) { toast.error("Enter an email address"); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { toast.error("Enter a valid email address"); return; }
    if (config.email_recipients.includes(email)) { toast.error("Email already added"); return; }
    setConfig({ ...config, email_recipients: [...config.email_recipients, email] });
    setNewEmail("");
  };

  const handleRemoveEmail = (email: string) => {
    setConfig({ ...config, email_recipients: config.email_recipients.filter((e) => e !== email) });
  };

  const handleAddPhone = async () => {
    if (!newPhoneNumber.trim()) { toast.error("Enter a phone number"); return; }
    let phone = newPhoneNumber.trim();
    if (phone.startsWith("0")) phone = "254" + phone.substring(1);
    else if (!phone.startsWith("254")) phone = "254" + phone;

    setIsAddingPhone(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const res = await fetch(`${apiUrl}/api/sms-report-recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: phone }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        toast.success(`${phone} added`);
        setNewPhoneNumber("");
        const r = await fetch(`${apiUrl}/api/sms-report-recipients`);
        if (r.ok) { const d = await r.json(); setSmsRecipients(d.data || []); }
      } else {
        toast.error(result.error || "Failed to add phone number");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add phone number");
    } finally {
      setIsAddingPhone(false);
    }
  };

  const handleRemovePhone = async (phoneNumber: string) => {
    if (!confirm(`Remove ${phoneNumber}?`)) return;
    setIsRemovingPhone(phoneNumber);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const token = localStorage.getItem('authToken');
      const res = await fetch(
        `${apiUrl}/api/sms-report-recipients/${encodeURIComponent(phoneNumber)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      const result = await res.json();
      if (res.ok && result.success) {
        toast.success("Phone number removed");
        const r = await fetch(`${apiUrl}/api/sms-report-recipients`);
        if (r.ok) { const d = await r.json(); setSmsRecipients(d.data || []); }
      } else {
        toast.error(result.error || "Failed to remove phone number");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove phone number");
    } finally {
      setIsRemovingPhone(null);
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
      {hasUnsavedChanges && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-amber-700 dark:text-amber-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Unsaved changes — click <strong>Save Setup</strong> below to apply.</span>
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border/50 h-full">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
                <Send className="w-4 h-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Telegram Bot</CardTitle>
                <CardDescription className="text-xs">
                  Bot token and chat ID used for Telegram delivery
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Bot Token <span className="text-destructive">*</span>
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Obtain from <code className="bg-muted px-1 rounded">@BotFather</code> on Telegram
              </p>
              <Input
                type="password"
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                value={config.bot_token}
                onChange={(e) => { setConfig({ ...config, bot_token: e.target.value }); setHasUnsavedChanges(true); }}
                className="font-mono text-sm h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Chat ID <span className="text-destructive">*</span>
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Send a message to your bot, then check the getUpdates endpoint
              </p>
              <Input
                placeholder="123456789"
                value={config.chat_id}
                onChange={(e) => { setConfig({ ...config, chat_id: e.target.value }); setHasUnsavedChanges(true); }}
                className="font-mono text-sm h-9"
              />
            </div>

            {testResult && (
              <Alert variant={testResult.success ? "default" : "destructive"}>
                <div className="flex items-start gap-2">
                  {testResult.success ? (
                    <CheckCircle className="w-4 h-4 mt-0.5 text-green-500" />
                  ) : (
                    <AlertCircle className="w-4 h-4 mt-0.5" />
                  )}
                  <AlertDescription className="text-xs">{testResult.message}</AlertDescription>
                </div>
              </Alert>
            )}

            <Button
              onClick={handleTestTelegram}
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
          </CardContent>
        </Card>

        <Card className="border-border/50 h-full">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-500/10">
                <Mail className="w-4 h-4 text-slate-500" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Email SMTP</CardTitle>
                <CardDescription className="text-xs">
                  Mail server credentials used for email alert delivery
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Host</Label>
                <Input
                  placeholder="smtp.gmail.com"
                  value={config.email_smtp_host}
                  onChange={(e) => { setConfig({ ...config, email_smtp_host: e.target.value }); setHasUnsavedChanges(true); }}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Port</Label>
                <Input
                  type="number"
                  placeholder="587"
                  value={config.email_smtp_port}
                  onChange={(e) => { setConfig({ ...config, email_smtp_port: Number(e.target.value) }); setHasUnsavedChanges(true); }}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Encryption</Label>
              <Select
                value={config.email_smtp_encryption}
                onValueChange={(v) => { setConfig({ ...config, email_smtp_encryption: v }); setHasUnsavedChanges(true); }}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select encryption" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (detect by port)</SelectItem>
                  <SelectItem value="ssl">SSL / TLS (port 465)</SelectItem>
                  <SelectItem value="starttls">STARTTLS (port 587)</SelectItem>
                  <SelectItem value="none">None (unencrypted)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Auto: uses SSL if port 465, otherwise STARTTLS</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Username</Label>
              <Input
                placeholder="you@gmail.com"
                value={config.email_smtp_user}
                onChange={(e) => { setConfig({ ...config, email_smtp_user: e.target.value }); setHasUnsavedChanges(true); }}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Password / App Password</Label>
              <Input
                type="password"
                placeholder="••••••••••••"
                value={config.email_smtp_pass}
                onChange={(e) => { setConfig({ ...config, email_smtp_pass: e.target.value }); setHasUnsavedChanges(true); }}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                From Address <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                placeholder="alerts@yourcompany.com"
                value={config.email_from}
                onChange={(e) => { setConfig({ ...config, email_from: e.target.value }); setHasUnsavedChanges(true); }}
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                Defaults to SMTP username if left empty
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 h-full">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-500/10">
                <Mail className="w-4 h-4 text-slate-500" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Email Recipients</CardTitle>
                <CardDescription className="text-xs">
                  Addresses that receive email reports and notifications
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddEmail())}
                className="h-9"
              />
              <Button size="sm" variant="outline" onClick={handleAddEmail} className="gap-2">
                <Plus className="w-4 h-4" />
                Add
              </Button>
            </div>
            {config.email_recipients.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-border/30 bg-muted/20 p-3">
                {config.email_recipients.map((email) => (
                  <div
                    key={email}
                    className="flex items-center justify-between rounded bg-background/50 p-2 text-xs"
                  >
                    <span className="font-mono">{email}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleRemoveEmail(email)}
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <Alert>
                <AlertDescription className="text-xs">
                  No email recipients added yet.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 h-full">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/10">
                <Phone className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">SMS Recipients</CardTitle>
                <CardDescription className="text-xs">
                  Phone numbers that receive SMS reports and alerts
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
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddPhone())}
                className="font-mono text-sm h-9 flex-1"
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

            {smsRecipients.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-border/30 bg-muted/20 p-3">
                {smsRecipients.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded bg-background/50 p-2 text-xs"
                  >
                    <span className="font-mono">{r.phone_number}</span>
                    <Button
                      onClick={() => handleRemovePhone(r.phone_number)}
                      disabled={isRemovingPhone === r.phone_number}
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                    >
                      {isRemovingPhone === r.phone_number ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3 text-destructive" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <Alert>
                <AlertDescription className="text-xs">
                  No SMS recipients added yet.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving} size="sm" className="gap-2">
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {isSaving ? "Saving..." : "Save Setup"}
        </Button>
      </div>
    </div>
  );
};
