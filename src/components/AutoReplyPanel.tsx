import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { MessageSquareReply, Save, Loader2, Info } from "lucide-react";
import { useAutoReplyConfig, useUpdateAutoReplyConfig } from "@/hooks/useAutoReplyConfig";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export const AutoReplyPanel = () => {
  const { data: config, isLoading } = useAutoReplyConfig();
  const { mutate: updateConfig, isPending } = useUpdateAutoReplyConfig();

  const [localEnabled, setLocalEnabled] = useState<boolean | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [localEmail, setLocalEmail] = useState<string | null>(null);

  const enabled = localEnabled !== null ? localEnabled : (config?.enabled ?? false);
  const message =
    localMessage !== null
      ? localMessage
      : config?.message ?? "Thank you for your message. We will get back to you shortly.";
  const notificationEmail =
    localEmail !== null ? localEmail : (config?.notification_email ?? "");

  const handleSave = () => {
    updateConfig(
      { enabled, message, notification_email: notificationEmail.trim() || null },
      {
        onSuccess: () => toast.success("Auto-reply settings saved"),
        onError: (err) => toast.error(err.message),
      }
    );
  };

  if (isLoading) {
    return <Skeleton className="h-64 rounded-lg" />;
  }

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
                Automatically reply to incoming SMS on all SIM ports
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
              onCheckedChange={(v) => setLocalEnabled(v)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Status banner */}
        <div
          className={`flex items-start gap-2 p-3 rounded-lg text-xs ${
            enabled
              ? "bg-success/10 border border-success/30 text-success"
              : "bg-muted/40 border border-border/30 text-muted-foreground"
          }`}
        >
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {enabled
            ? "Auto-reply is active. Incoming SMS on all SIM ports will receive the message below."
            : "Auto-reply is disabled. Toggle above to activate."}
        </div>

        {/* Message composer */}
        <div className="space-y-2">
          <Label htmlFor="auto-reply-message" className="text-sm font-medium">
            Reply Message
          </Label>
          <Textarea
            id="auto-reply-message"
            value={message}
            onChange={(e) => setLocalMessage(e.target.value)}
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
            Missed Call Notification Email
          </Label>
          <Input
            id="notification-email"
            type="email"
            value={notificationEmail}
            onChange={(e) => setLocalEmail(e.target.value)}
            placeholder="admin@yourcompany.com"
            className="bg-muted/30 border-border/50 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            This email receives alerts when a missed call occurs.
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
