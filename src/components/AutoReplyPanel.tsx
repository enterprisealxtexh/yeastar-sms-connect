import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { MessageSquareReply, Save, Loader2, Info, AlertCircle, Users } from "lucide-react";
import { useAutoReplyConfig, useUpdateAutoReplyConfig } from "@/hooks/useAutoReplyConfig";
import { useExtensions } from "@/hooks/useExtensions";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export const AutoReplyPanel = () => {
  const { data: config, isLoading } = useAutoReplyConfig();
  const { mutate: updateConfig, isPending } = useUpdateAutoReplyConfig();
  const { extensions } = useExtensions();

  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("Thank you for your message. We will get back to you shortly.");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [allowedExtensions, setAllowedExtensions] = useState<string[]>([]);

  // Populate from API
  useEffect(() => {
    if (config) {
      setEnabled(!!config.enabled);
      setMessage(config.message ?? "Thank you for your message. We will get back to you shortly.");
      setNotificationEmail(config.notification_email ?? "");
      setAllowedExtensions((() => {
        const raw = (config as any).allowed_extensions;
        if (Array.isArray(raw)) return raw;
        if (typeof raw === "string") {
          try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
        }
        return [];
      })());
    }
  }, [config]);

  const toggleExtension = (extnumber: string) => {
    setAllowedExtensions(prev =>
      prev.includes(extnumber)
        ? prev.filter(e => e !== extnumber)
        : [...prev, extnumber].sort()
    );
  };

  const handleSave = () => {
    updateConfig(
      {
        enabled,
        message,
        notification_email: notificationEmail.trim() || null,
        allowed_extensions: allowedExtensions,
      },
      {
        onSuccess: () => toast.success("Auto-reply settings saved"),
        onError: (err) => toast.error(err.message),
      }
    );
  };

  if (isLoading) {
    return <Skeleton className="h-64 rounded-lg" />;
  }

  const noneSelected = allowedExtensions.length === 0;

  return (
    <Card className="card-glow border-border/50 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <MessageSquareReply className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Auto-Reply SMS</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automatically reply to incoming SMS — select which extensions are monitored
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="auto-reply-enabled" className="text-sm text-muted-foreground cursor-pointer">
              {enabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id="auto-reply-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Status banner */}
        <div
          className={`flex items-start gap-2 p-3 rounded-lg text-xs ${
            enabled && !noneSelected
              ? "bg-success/10 border border-success/30 text-success"
              : "bg-muted/40 border border-border/30 text-muted-foreground"
          }`}
        >
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {!enabled
            ? "Auto-reply is disabled. Toggle above to activate."
            : noneSelected
              ? "Auto-reply is enabled but no extensions are selected — no replies will fire until you select at least one extension below."
              : `Auto-reply is active for ${allowedExtensions.length} extension${allowedExtensions.length !== 1 ? 's' : ''}: ${allowedExtensions.join(', ')}.`}
        </div>

        {/* Extension Monitor Selection */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-500" />
            Monitored Extensions
          </h3>
          <p className="text-xs text-muted-foreground">
            Select which extensions should trigger auto-reply. Extensions not selected will be ignored.
            <strong className="text-foreground"> At least one must be selected for auto-reply to fire.</strong>
          </p>
          <div className="p-4 rounded-lg bg-muted/30 border border-border/30 space-y-2">
            {extensions.length > 0 ? (
              extensions.map((ext) => (
                <div key={ext.extnumber} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 transition">
                  <Checkbox
                    id={`ar-ext-${ext.extnumber}`}
                    checked={allowedExtensions.includes(ext.extnumber)}
                    onCheckedChange={() => toggleExtension(ext.extnumber)}
                  />
                  <Label htmlFor={`ar-ext-${ext.extnumber}`} className="text-sm cursor-pointer flex-1">
                    {ext.extnumber}{ext.username ? ` — ${ext.username}` : ''}
                  </Label>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground italic">No extensions found — fetched from your PBX</p>
            )}
            {noneSelected && extensions.length > 0 && (
              <Alert className="border-amber-500/50 bg-amber-500/5 mt-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-xs text-amber-700">
                  No extensions selected — auto-reply will not fire even when enabled.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        <Separator />

        {/* Message composer */}
        <div className="space-y-2">
          <Label htmlFor="auto-reply-message" className="text-sm font-medium">
            Reply Message
          </Label>
          <Textarea
            id="auto-reply-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={160}
            placeholder="Type your auto-reply message here..."
            className="bg-muted/30 border-border/50 resize-none text-sm"
          />
          <p className="text-xs text-muted-foreground text-right">
            {message.length}/160 characters
          </p>
        </div>

        {/* Notification email */}
        <div className="space-y-2">
          <Label htmlFor="notification-email" className="text-sm font-medium">
            Notification Email
          </Label>
          <Input
            id="notification-email"
            type="email"
            value={notificationEmail}
            onChange={(e) => setNotificationEmail(e.target.value)}
            placeholder="admin@yourcompany.com"
            className="bg-muted/30 border-border/50 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Optional — receives alerts when auto-reply fires or fails.
          </p>
        </div>

        <div className="pt-1">
          <Button onClick={handleSave} disabled={isPending} size="sm" className="gap-2">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
