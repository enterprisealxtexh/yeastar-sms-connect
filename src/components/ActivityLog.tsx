import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, CheckCircle, AlertCircle, Info, XCircle } from "lucide-react";

interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
}

interface ActivityLogProps {
  logs: LogEntry[];
  isFullPage?: boolean;
}

export const ActivityLog = ({ logs, isFullPage = false }: ActivityLogProps) => {
  const getLogIcon = (level: LogEntry["level"]) => {
    switch (level) {
      case "success":
        return <CheckCircle className="w-4 h-4 text-success" />;
      case "warning":
        return <AlertCircle className="w-4 h-4 text-warning" />;
      case "error":
        return <XCircle className="w-4 h-4 text-destructive" />;
      default:
        return <Info className="w-4 h-4 text-primary" />;
    }
  };

  return (
    <Card className="card-glow border-border/50 bg-card h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <CardTitle className="text-base font-semibold">Activity Log</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className={isFullPage ? "h-[calc(100vh-300px)]" : "h-[300px]"}>
          <div className="divide-y divide-border/30">
            {logs.map((log) => (
              <div
                key={log.id}
                className="px-4 py-3 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{getLogIcon(log.level)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground leading-snug">
                      {log.message}
                    </p>
                    <p className="text-xs font-mono text-muted-foreground mt-1">
                      {log.timestamp}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
