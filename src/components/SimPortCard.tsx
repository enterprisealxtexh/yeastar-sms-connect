import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusIndicator } from "./StatusIndicator";
import { Signal, MessageSquare } from "lucide-react";

interface SimPortCardProps {
  port: number;
  status: "online" | "offline" | "warning";
  phoneNumber: string;
  signalStrength: number;
  messageCount: number;
  mappedExtension?: string;
}

export const SimPortCard = ({
  port,
  status,
  phoneNumber,
  signalStrength,
  messageCount,
  mappedExtension,
}: SimPortCardProps) => {
  const getSignalBars = (strength: number) => {
    const bars = Math.ceil(strength / 25);
    return Array.from({ length: 4 }, (_, i) => (
      <div
        key={i}
        className={`w-1 rounded-sm transition-all ${
          i < bars
            ? "bg-primary"
            : "bg-muted"
        }`}
        style={{ height: `${(i + 1) * 4}px` }}
      />
    ));
  };

  return (
    <Card className="card-glow border-border/50 bg-card hover:border-primary/30 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="font-semibold text-foreground">Port {port}</h3>
              <p className="text-xs font-mono text-muted-foreground">{phoneNumber}</p>
            </div>
          </div>
          <StatusIndicator status={status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Signal className="w-4 h-4" />
            <span>Signal</span>
          </div>
          <div className="flex items-end gap-0.5">
            {getSignalBars(signalStrength)}
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MessageSquare className="w-4 h-4" />
            <span>Messages</span>
          </div>
          <span className="font-mono text-foreground">{messageCount}</span>
        </div>
        {mappedExtension && (
          <div className="pt-2 border-t border-border/50">
            <p className="text-xs text-muted-foreground">
              Mapped to: <span className="font-mono text-primary">{mappedExtension}</span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
