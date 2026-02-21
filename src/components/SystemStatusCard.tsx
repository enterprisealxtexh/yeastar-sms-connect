import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LucideIcon } from "lucide-react";

interface SystemStatusCardProps {
  title: string;
  status: "online" | "offline" | "warning";
  statusLabel: string;
  icon: LucideIcon;
  details: { label: string; value: string }[];
}

export const SystemStatusCard = ({
  title,
  status,
  statusLabel,
  icon: Icon,
  details,
}: SystemStatusCardProps) => {
  return (
    <Card className="card-glow border-border/50 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
          </div>
          <Badge variant={status === "online" ? "default" : status === "warning" ? "secondary" : "destructive"}>
            {statusLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {details.map((detail, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{detail.label}</span>
              <span className="font-mono text-foreground">{detail.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
