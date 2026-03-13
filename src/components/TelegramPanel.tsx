import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Send, MessageSquare, Phone, FileText, Server, AlertTriangle, BarChart3 } from "lucide-react";
import { useTelegramNotify, TelegramAction } from "../hooks/useTelegramNotify";

const actions: { action: TelegramAction; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  {
    action: "system_summary",
    label: "Full Summary",
    description: "SMS, calls, logs, SIMs & config overview",
    icon: BarChart3,
  },
  {
    action: "sms_logs",
    label: "SMS Logs",
    description: "Last 20 SMS messages with details",
    icon: MessageSquare,
  },
  {
    action: "call_logs",
    label: "Call Logs",
    description: "Last 20 call records with status",
    icon: Phone,
  },
  {
    action: "activity_logs",
    label: "Activity Logs",
    description: "Last 20 system activity entries",
    icon: FileText,
  },
  {
    action: "gateway_status",
    label: "Gateway & PBX",
    description: "Gateway, PBX config & SIM port status",
    icon: Server,
  },
  {
    action: "error_logs",
    label: "Error Report",
    description: "Unresolved errors with AI diagnosis",
    icon: AlertTriangle,
  },
];

export const TelegramPanel = () => {
  const telegramNotify = useTelegramNotify();

  const handleSend = (action: TelegramAction) => {
    telegramNotify.mutate(action);
  };

  return (
    <Card className="card-glow border-border/50 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
            <Send className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Telegram Reports</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Send system data to your Telegram bot
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          Telegram bot token and chat ID are configured only in Settings / Alerts.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map(({ action, label, description, icon: Icon }) => (
            <Button
              key={action}
              variant="outline"
              className="h-auto flex-col items-start gap-2 p-4 text-left border-border/50 hover:bg-muted/50 hover:border-primary/30 transition-all"
              onClick={() => handleSend(action)}
              disabled={telegramNotify.isPending}
            >
              <div className="flex items-center gap-2 w-full">
                <Icon className="w-4 h-4 text-primary shrink-0" />
                <span className="font-medium text-sm">{label}</span>
              </div>
              <span className="text-xs text-muted-foreground leading-snug">
                {description}
              </span>
            </Button>
          ))}
        </div>
        {telegramNotify.isPending && (
          <p className="text-xs text-muted-foreground mt-3 animate-pulse text-center">
            Sending to Telegram…
          </p>
        )}
      </CardContent>
    </Card>
  );
};
