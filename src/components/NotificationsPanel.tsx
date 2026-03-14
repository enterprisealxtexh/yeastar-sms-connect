import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Save,
  PhoneMissed,
  PhoneCall,
  MessageSquare,
  Clock,
  Users,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  AlertCircle,
  Send,
  Mail,
  Bell,
  FileText,
  CheckCircle2,
} from "lucide-react";
import {
  useCallAutoSmsConfig,
  useUpdateCallAutoSmsConfig,
} from "@/hooks/useCallAutoSmsConfig";
import { useExtensions } from "@/hooks/useExtensions";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TemplateModal } from "./TemplateModal";
import { useAuth } from "@/hooks/useAuth";

interface AlertConfig {
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

export const NotificationsPanel = () => {
  const { isAdmin } = useAuth();

  // ── SMS state ──────────────────────────────────────────────────────────────
  const { data: config, isLoading: smsLoading } = useCallAutoSmsConfig();
  const updateConfig = useUpdateCallAutoSmsConfig();
  const { extensions } = useExtensions();

  const [enabled, setEnabled] = useState(false);
  const [answeredMessage, setAnsweredMessage] = useState(
    "Thank you for calling us! We appreciate your business and are here to help anytime."
  );
  const [missedMessage, setMissedMessage] = useState(
    "We missed your call! Sorry we couldn't answer. We'll get back to you shortly. Your call is important to us."
  );
  const [delayEnabled, setDelayEnabled] = useState(true);
  const [delayMinutes, setDelayMinutes] = useState(5);
  const [duplicateWindow, setDuplicateWindow] = useState(10);
  const [allowedExtensions, setAllowedExtensions] = useState<string[]>([]);
  const [callDirection, setCallDirection] = useState<'both' | 'inbound' | 'outbound'>('both');

  // ── Telegram / Email state ─────────────────────────────────────────────────
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({
    enabled: false,
    email_enabled: false,
    sms_enabled: false,
    notify_missed_calls: true,
    notify_new_sms: false,
    notify_system_errors: true,
    notify_shift_changes: true,
    daily_report_enabled: false,
    daily_report_time: "18:00",
  });
  const [alertLoading, setAlertLoading] = useState(true);
  const [alertSaving, setAlertSaving] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  // ── Notification templates state ───────────────────────────────────────────
  const [notifTemplates, setNotifTemplates] = useState<Record<string, string>>({});

  // populate SMS from API
  useEffect(() => {
    if (config) {
      setEnabled(!!config.enabled);
      setAnsweredMessage(config.answered_message);
      setMissedMessage(config.missed_message);
      setDelayEnabled(config.delay_enabled !== false);
      setDelayMinutes(config.delay_minutes || 5);
      setDuplicateWindow(config.duplicate_window || 10);
      setAllowedExtensions(config.allowed_extensions || []);
      setCallDirection((config.call_direction as 'both' | 'inbound' | 'outbound') || 'both');
    }
  }, [config]);

  // populate Telegram/Email from API
  useEffect(() => {
    const load = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL;
        const [setupRes, channelRes, tplRes] = await Promise.all([
          fetch(`${apiUrl}/api/notifications-setup`),
          fetch(`${apiUrl}/api/channel-setup`),
          fetch(`${apiUrl}/api/notification-templates`),
        ]);
        if (setupRes.ok) {
          const { data } = await setupRes.json();
          if (data) {
            setAlertConfig({
              enabled:              !!data.telegram_enabled,
              email_enabled:        !!data.email_enabled,
              sms_enabled:          data.sms_reports_enabled === undefined ? true : !!data.sms_reports_enabled,
              notify_missed_calls:  data.notify_missed_calls  === undefined ? true : !!data.notify_missed_calls,
              notify_new_sms:       !!data.notify_new_sms,
              notify_system_errors: data.notify_system_errors === undefined ? true : !!data.notify_system_errors,
              notify_shift_changes: data.notify_shift_changes === undefined ? true : !!data.notify_shift_changes,
              daily_report_enabled: !!data.daily_report_enabled,
              daily_report_time:    data.daily_report_time || "18:00",
            });
          }
        }
        if (channelRes.ok) {
          const { data: channelData } = await channelRes.json();
          setSmtpConfigured(!!(channelData?.email_smtp_host && channelData?.email_smtp_user && channelData?.email_smtp_pass));
        }
        if (tplRes.ok) {
          const { data: tpls } = await tplRes.json();
          if (Array.isArray(tpls)) {
            const map: Record<string, string> = {};
            tpls.forEach((t: { event_type: string; template_text: string }) => {
              map[t.event_type] = t.template_text;
            });
            setNotifTemplates(map);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setAlertLoading(false);
      }
    };
    load();
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSmsSave = () => {
    updateConfig.mutate(
      {
        enabled,
        answered_message: answeredMessage,
        missed_message: missedMessage,
        delay_enabled: delayEnabled,
        delay_minutes: delayMinutes,
        duplicate_window: duplicateWindow,
        allowed_extensions: allowedExtensions,
        call_direction: callDirection,
      },
      {
        onSuccess: () => toast.success("SMS settings saved"),
        onError: (err) => toast.error(err.message),
      }
    );
  };

  const saveAlertConfig = async (patch: Partial<AlertConfig>, setSaving: (v: boolean) => void) => {
    setSaving(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      // Merge current UI state with the incoming patch for a complete update
      const merged = { ...alertConfig, ...patch };

      // Map internal UI field names to the notifications_setup table column names
      const payload = {
        telegram_enabled:    merged.enabled,
        email_enabled:       merged.email_enabled,
        sms_reports_enabled: merged.sms_enabled,
        notify_missed_calls: merged.notify_missed_calls,
        notify_new_sms:      merged.notify_new_sms,
        notify_system_errors: merged.notify_system_errors,
        notify_shift_changes: merged.notify_shift_changes,
        daily_report_enabled: merged.daily_report_enabled,
        daily_report_time:   merged.daily_report_time,
      };

      const res = await fetch(`${apiUrl}/api/notifications-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save");
      const result = await res.json();
      if (result.success) {
        const saved = result?.data;
        if (saved) {
          setAlertConfig({
            enabled:              !!saved.telegram_enabled,
            email_enabled:        !!saved.email_enabled,
            sms_enabled:          saved.sms_reports_enabled === undefined ? true : !!saved.sms_reports_enabled,
            notify_missed_calls:  saved.notify_missed_calls  === undefined ? true : !!saved.notify_missed_calls,
            notify_new_sms:       !!saved.notify_new_sms,
            notify_system_errors: saved.notify_system_errors === undefined ? true : !!saved.notify_system_errors,
            notify_shift_changes: saved.notify_shift_changes === undefined ? true : !!saved.notify_shift_changes,
            daily_report_enabled: !!saved.daily_report_enabled,
            daily_report_time:    saved.daily_report_time || "18:00",
          });
        }
        toast.success("Settings saved");
      } else throw new Error(result.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateReport = async () => {
    setGeneratingReport(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const res = await fetch(`${apiUrl}/api/manual-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const result = await res.json();
      console.log('Manual report response:', { status: res.status, result }); // Debug log
      if (res.ok && result.success) {
        toast.success(`Report generated and sent`);
      } else {
        // Show detailed error if available, otherwise fallback to generic error
        const errorMsg = result.details || result.error || "Failed to generate report";
        console.warn('Manual report error:', errorMsg); // Debug log
        toast.error(errorMsg);
      }
    } catch (e) {
      console.error('Manual report exception:', e); // Debug log
      toast.error(e instanceof Error ? e.message : "Failed to generate report");
    } finally {
      setGeneratingReport(false);
    }
  };

  const [testingSms, setTestingSms] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [smtpConfigured, setSmtpConfigured] = useState(false);

  const handleTestSms = async () => {
    setTestingSms(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const res = await fetch(`${apiUrl}/api/test-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await res.json();
      console.log('SMS test response:', result);
      if (res.ok && result.success) {
        toast.success(`Test SMS sent to ${result.details}`);
      } else {
        toast.error(result.error || 'SMS test failed');
      }
    } catch (e) {
      console.error('SMS test error:', e);
      toast.error(e instanceof Error ? e.message : 'SMS test failed');
    } finally {
      setTestingSms(false);
    }
  };

  const handleTestEmail = async () => {
    if (!smtpConfigured) {
      toast.error('SMTP not configured. Please enter and save your SMTP credentials in Setup → Email Settings first.');
      return;
    }
    setTestingEmail(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const res = await fetch(`${apiUrl}/api/test-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await res.json();
      console.log('Email test response:', result);
      if (res.ok && result.success) {
        toast.success(`Test email sent to ${result.details}`);
      } else {
        const msg = result.details || result.error || 'Email test failed';
        toast.error(msg);
      }
    } catch (e) {
      console.error('Email test error:', e);
      toast.error(e instanceof Error ? e.message : 'Email test failed');
    } finally {
      setTestingEmail(false);
    }
  };

  // ── Save a notification alert template ──────────────────────────────────────
  const saveNotifTemplate = async (eventType: string, text: string) => {
    const apiUrl = import.meta.env.VITE_API_URL;
    const res = await fetch(`${apiUrl}/api/notification-templates/${eventType}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_text: text }),
    });
    const result = await res.json();
    if (result.success) {
      setNotifTemplates(prev => ({ ...prev, [eventType]: text }));
      toast.success('Template saved');
    } else throw new Error(result.error || 'Failed to save template');
  };

  // ── Shared Events card (used in Telegram + Email tabs) ─────────────────────
  const EVENT_DEFS = [
    {
      key: 'notify_missed_calls' as const,
      eventType: 'missed_call',
      label: 'Missed Calls',
      description: 'Alert when an inbound call goes unanswered',
      vars: ['{caller}', '{extension}', '{extension_name}', '{time}', '{date}', '{duration}'],
    },
    {
      key: 'notify_new_sms' as const,
      eventType: 'new_sms',
      label: 'New SMS Messages',
      description: 'Alert when a new inbound SMS is received',
      vars: ['{caller}', '{port}', '{time}', '{message}'],
    },
    {
      key: 'notify_system_errors' as const,
      eventType: 'system_error',
      label: 'System Errors',
      description: 'Alert on critical system faults or save failures',
      vars: ['{error_type}', '{error_message}', '{time}'],
    },
    {
      key: 'notify_shift_changes' as const,
      eventType: 'shift_change',
      label: 'Shift Changes',
      description: 'Alert on clock-in, clock-out, swap requests',
      vars: ['{action}', '{agent}', '{time}'],
    },
  ] as const;

  type EventType = 'missed_call' | 'new_sms' | 'system_error' | 'shift_change' | 'daily_report';

  const handleEventToggle = async (key: keyof AlertConfig, eventType: EventType, value: boolean) => {
    const hasTemplate = !!(notifTemplates[eventType]?.trim());
    setAlertConfig(prev => ({ ...prev, [key]: value }));
    if (value && !hasTemplate) {
      toast.warning('No template configured — use "Manage Templates" to set one, or the default format will be used.');
    }
    await saveAlertConfig({ [key]: value }, setAlertSaving);
  };

  const handleTelegramEnabledToggle = async (value: boolean) => {
    setAlertConfig(prev => ({ ...prev, enabled: value }));
    await saveAlertConfig({ enabled: value }, setAlertSaving);
  };

  const handleSmsEnabledToggle = async (value: boolean) => {
    setAlertConfig(prev => ({ ...prev, sms_enabled: value }));
    await saveAlertConfig({ sms_enabled: value }, setAlertSaving);
  };

  const handleDailyReportToggle = async (value: boolean) => {
    setAlertConfig(prev => ({ ...prev, daily_report_enabled: value }));
    await saveAlertConfig({ daily_report_enabled: value }, setAlertSaving);
  };

  const handleDailyReportTimeChange = async (newTime: string) => {
    setAlertConfig(prev => ({ ...prev, daily_report_time: newTime }));
    await saveAlertConfig({ daily_report_time: newTime }, setAlertSaving);
  };

  const handleEmailEnabledToggle = async (value: boolean) => {
    setAlertConfig(prev => ({ ...prev, email_enabled: value }));
    await saveAlertConfig({ email_enabled: value }, setAlertSaving);
  };

  if (smsLoading || alertLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-20">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <Bell className="w-10 h-10 mx-auto text-muted-foreground/50" />
            <h2 className="text-lg font-semibold">Access Restricted</h2>
            <p className="text-sm text-muted-foreground">
              Notifications settings are only available to Admin and Super Admin roles.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold">Notifications</h1>
        <p className="text-muted-foreground mt-1">
          Manage all notification channels — SMS, Telegram, and Email.
        </p>
      </div>

      {/* Channel Tabs */}
      <Tabs defaultValue="sms" className="space-y-6">
        <TabsList className="bg-card border border-border/50">
          <TabsTrigger value="sms" className="gap-2">
            <MessageSquare className="w-4 h-4" />
            SMS
          </TabsTrigger>
          <TabsTrigger value="telegram" className="gap-2">
            <Send className="w-4 h-4" />
            Telegram
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-2">
            <Mail className="w-4 h-4" />
            Email
          </TabsTrigger>
        </TabsList>

        {/* ── SMS Tab ──────────────────────────────────────────────────────── */}
        <TabsContent value="sms" className="space-y-6">
          {/* SMS Reports card */}
          <Card>
            <CardHeader className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-violet-600" />
                  <div>
                    <CardTitle>SMS Reports</CardTitle>
                    <CardDescription>Send daily &amp; manual reports to configured phone numbers</CardDescription>
                  </div>
                </div>
                <Button onClick={handleTestSms} disabled={testingSms} variant="outline" className="gap-2">
                    {testingSms ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Test SMS
                  </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border/30">
                <div>
                  <Label className="text-sm font-medium">Enable SMS Reports</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Allow daily &amp; manual reports to be delivered via SMS to phone numbers saved in
                    <strong> Configuration → Setup</strong>
                  </p>
                </div>
                <Switch
                  checked={alertConfig.sms_enabled}
                  onCheckedChange={handleSmsEnabledToggle}
                  disabled={alertSaving}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This does <strong>not</strong> affect Post-Call Auto-Reply below — that is configured independently.
              </p>
            </CardContent>
          </Card>

          {/* Post-Call Auto-Reply card */}
          <Card>
            <CardHeader className="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-blue-600" />
                  <div>
                    <CardTitle>Post-Call Auto-Reply</CardTitle>
                    <CardDescription>Automatically reply to callers via SMS after their call ends</CardDescription>
                  </div>
                </div>
                <Button onClick={handleSmsSave} disabled={updateConfig.isPending} className="gap-2">
                  {updateConfig.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Settings
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {/* Enable */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border/30">
                <div>
                  <Label className="text-sm font-medium">Enable Post-Call Auto-Reply</Label>
                  <p className="text-xs text-muted-foreground mt-1">Send an SMS to the caller after each answered or missed call</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <Separator />

              {/* Message Templates */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Message Templates</h3>
                <p className="text-xs text-muted-foreground">Customize SMS content for answered and missed calls.</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="p-4 rounded-lg bg-muted/30 border border-border/30 space-y-2">
                    <div className="flex items-center gap-2">
                      <PhoneCall className="w-4 h-4 text-green-500" />
                      <Label className="text-sm font-medium">Answered Call Message</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">Sent when the call was answered</p>
                    <Textarea
                      value={answeredMessage}
                      onChange={(e) => setAnsweredMessage(e.target.value)}
                      placeholder="Thank you for calling..."
                      className="min-h-[100px] text-sm bg-background/50"
                      maxLength={500}
                    />
                    <span className="text-[10px] text-muted-foreground">{answeredMessage.length}/500</span>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/30 border border-border/30 space-y-2">
                    <div className="flex items-center gap-2">
                      <PhoneMissed className="w-4 h-4 text-destructive" />
                      <Label className="text-sm font-medium">Missed Call Message</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">Sent when the call went unanswered</p>
                    <Textarea
                      value={missedMessage}
                      onChange={(e) => setMissedMessage(e.target.value)}
                      placeholder="We missed your call..."
                      className="min-h-[100px] text-sm bg-background/50"
                      maxLength={500}
                    />
                    <span className="text-[10px] text-muted-foreground">{missedMessage.length}/500</span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Template Variables */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Template Variables</h3>
                <div className="p-3 rounded-lg bg-accent/30 border border-accent/50">
                  <p className="text-xs font-medium text-accent-foreground mb-3">Use these in your messages:</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {[
                      { var: "{caller_name}", desc: "Caller name" },
                      { var: "{caller_number}", desc: "Phone number" },
                      { var: "{extension}", desc: "Extension" },
                      { var: "{time}", desc: "Call time" },
                      { var: "{date}", desc: "Call date" },
                      { var: "{duration}", desc: "Duration" },
                    ].map((v) => (
                      <div key={v.var} className="text-xs">
                        <code className="bg-background/50 px-1.5 py-0.5 rounded font-mono text-accent-foreground font-semibold">{v.var}</code>
                        <p className="text-[10px] text-accent-foreground/70 mt-0.5">{v.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <Separator />

              {/* Delivery Settings */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-500" />
                  Delivery Settings
                </h3>
                <p className="text-xs text-muted-foreground">Control timing and prevent duplicate messages.</p>
                <div className="space-y-4 p-4 rounded-lg bg-muted/30 border border-border/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-medium">Enable Delivery Delay</Label>
                      <p className="text-xs text-muted-foreground mt-1">Delay SMS to prevent duplicates if caller calls back immediately</p>
                    </div>
                    <Switch checked={delayEnabled} onCheckedChange={setDelayEnabled} />
                  </div>
                  {delayEnabled && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">
                          Delay Time: <span className="font-bold">{delayMinutes}</span> minute{delayMinutes !== 1 ? "s" : ""}
                        </Label>
                        <Slider value={[delayMinutes]} onValueChange={(v) => setDelayMinutes(v[0])} min={0} max={120} step={1} className="w-full" />
                        <p className="text-xs text-muted-foreground">
                          {delayMinutes === 0 ? "Send immediately" : `SMS sent ${delayMinutes} minute${delayMinutes !== 1 ? "s" : ""} after call ends`}
                        </p>
                      </div>
                      <div className="space-y-2 pt-2">
                        <Label className="text-sm font-medium">
                          Duplicate Window: <span className="font-bold">{duplicateWindow}</span> minute{duplicateWindow !== 1 ? "s" : ""}
                        </Label>
                        <Slider value={[duplicateWindow]} onValueChange={(v) => setDuplicateWindow(v[0])} min={1} max={120} step={1} className="w-full" />
                        <p className="text-xs text-muted-foreground">
                          Skip SMS if same number received one within {duplicateWindow} minute{duplicateWindow !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <Separator />

              {/* Call Direction */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-orange-500" />
                  Call Direction
                </h3>
                <p className="text-xs text-muted-foreground">Choose which call directions trigger auto-SMS. Defaults to both.</p>
                <div className="flex gap-2 p-4 rounded-lg bg-muted/30 border border-border/30">
                  {[
                    { value: 'both' as const, icon: ArrowLeftRight, label: 'Both' },
                    { value: 'inbound' as const, icon: ArrowDownLeft, label: 'Inbound' },
                    { value: 'outbound' as const, icon: ArrowUpRight, label: 'Outbound' },
                  ].map(({ value, icon: Icon, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCallDirection(value)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                        callDirection === value
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:bg-muted'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
                {callDirection === 'outbound' && (
                  <p className="text-xs text-amber-600">
                    ⚠️ Outbound mode sends SMS to the external number your agent called.
                  </p>
                )}
              </div>

              <Separator />

              {/* Extension Filter */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-teal-500" />
                  Extension Filter
                </h3>
                <p className="text-xs text-muted-foreground">
                  Select which extensions trigger auto-SMS. Leave all unchecked to apply to every extension.
                </p>
                <div className="p-4 rounded-lg bg-muted/30 border border-border/30 space-y-2">
                  {extensions.length > 0 ? (
                    extensions.map((ext) => (
                      <div key={ext.extnumber} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 transition">
                        <Checkbox
                          id={`notif-ext-${ext.extnumber}`}
                          checked={allowedExtensions.includes(ext.extnumber)}
                          onCheckedChange={() =>
                            setAllowedExtensions(prev =>
                              prev.includes(ext.extnumber)
                                ? prev.filter(e => e !== ext.extnumber)
                                : [...prev, ext.extnumber].sort()
                            )
                          }
                        />
                        <Label htmlFor={`notif-ext-${ext.extnumber}`} className="text-sm cursor-pointer flex-1">
                          {ext.extnumber}{ext.username ? ` — ${ext.username}` : ''}
                        </Label>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No extensions found — fetched from your PBX</p>
                  )}
                  {allowedExtensions.length === 0 && extensions.length > 0 && (
                    <Alert className="border-blue-500/50 bg-blue-500/5">
                      <AlertCircle className="h-4 w-4 text-blue-600" />
                      <AlertDescription className="text-xs text-blue-700">All extensions will trigger auto-SMS (none restricted)</AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Telegram Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="telegram" className="space-y-4">
          <Card className="border-border/50">
            <CardHeader className="bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Send className="w-5 h-5 text-blue-600" />
                  <div>
                    <CardTitle>Telegram Notifications</CardTitle>
                    <CardDescription>Send alerts to a Telegram bot</CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border/30">
                <div>
                  <Label className="text-sm font-medium">Enable Telegram Notifications</Label>
                  <p className="text-xs text-muted-foreground mt-1">Send alerts to configured Telegram bot</p>
                </div>
                <Switch
                  checked={alertConfig.enabled}
                  onCheckedChange={handleTelegramEnabledToggle}
                  disabled={alertSaving}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Configure your Telegram bot token and chat ID in <strong>Configuration → Setup</strong>.
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Notification Events
              </CardTitle>
              <CardDescription className="text-xs">
                Toggle events — edit message templates via "Manage Templates" below
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {EVENT_DEFS.map(({ key, eventType, label, description }) => {
                const hasTemplate = !!(notifTemplates[eventType]?.trim());
                return (
                  <div key={key} className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Label className="text-sm font-medium">{label}</Label>
                        {hasTemplate ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/30">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Template set
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-600 border border-orange-500/30">
                            <AlertCircle className="w-2.5 h-2.5" /> No template
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    </div>
                    <Switch
                      checked={alertConfig[key]}
                      onCheckedChange={(v) => handleEventToggle(key, eventType, v)}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <Card className="border-border/50">
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
                  checked={alertConfig.daily_report_enabled}
                  onCheckedChange={handleDailyReportToggle}
                  disabled={alertSaving}
                />
              </div>
              {alertConfig.daily_report_enabled && (
                <div className="space-y-1">
                  <Label htmlFor="report-time-tg" className="text-xs text-muted-foreground">
                    Send Time (Nairobi)
                  </Label>
                  <Input
                    id="report-time-tg"
                    type="time"
                    value={alertConfig.daily_report_time}
                    onChange={(e) => handleDailyReportTimeChange(e.target.value)}
                    className="w-40"
                    disabled={alertSaving}
                  />
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={handleGenerateReport}
                  disabled={generatingReport}
                >
                  {generatingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  {generatingReport ? "Generating…" : "Generate Now"}
                </Button>
                <TemplateModal notifTemplates={notifTemplates} onSaveNotifTemplate={saveNotifTemplate} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Email Tab ────────────────────────────────────────────────────── */}
        <TabsContent value="email" className="space-y-4">
          <Card className="border-border/50">
            <CardHeader className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-green-600" />
                  <div>
                    <CardTitle>Email Notifications</CardTitle>
                    <CardDescription>Deliver alerts to email recipients</CardDescription>
                  </div>
                </div>
                <Button onClick={handleTestEmail} disabled={testingEmail} variant="outline" className="gap-2">
                    {testingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Test Email
                  </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border/30">
                <div>
                  <Label className="text-sm font-medium">Enable Email Notifications</Label>
                  <p className="text-xs text-muted-foreground mt-1">Deliver alerts to configured email recipients</p>
                </div>
                <Switch
                  checked={alertConfig.email_enabled}
                  onCheckedChange={handleEmailEnabledToggle}
                  disabled={alertSaving}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Configure SMTP credentials and email recipients in <strong>Configuration → Setup</strong>.
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Notification Events
              </CardTitle>
              <CardDescription className="text-xs">
                Toggle events — edit message templates via "Manage Templates" below
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {EVENT_DEFS.map(({ key, eventType, label, description }) => {
                const hasTemplate = !!(notifTemplates[eventType]?.trim());
                return (
                  <div key={key} className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Label className="text-sm font-medium">{label}</Label>
                        {hasTemplate ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/30">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Template set
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-600 border border-orange-500/30">
                            <AlertCircle className="w-2.5 h-2.5" /> No template
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    </div>
                    <Switch
                      checked={alertConfig[key]}
                      onCheckedChange={(v) => handleEventToggle(key, eventType, v)}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <Card className="border-border/50">
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
                  checked={alertConfig.daily_report_enabled}
                  onCheckedChange={handleDailyReportToggle}
                  disabled={alertSaving}
                />
              </div>
              {alertConfig.daily_report_enabled && (
                <div className="space-y-1">
                  <Label htmlFor="report-time-email" className="text-xs text-muted-foreground">
                    Send Time (Nairobi)
                  </Label>
                  <Input
                    id="report-time-email"
                    type="time"
                    value={alertConfig.daily_report_time}
                    onChange={(e) => handleDailyReportTimeChange(e.target.value)}
                    className="w-40"
                    disabled={alertSaving}
                  />
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={handleGenerateReport}
                  disabled={generatingReport}
                >
                  {generatingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  {generatingReport ? "Generating…" : "Generate Now"}
                </Button>
                <TemplateModal notifTemplates={notifTemplates} onSaveNotifTemplate={saveNotifTemplate} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
