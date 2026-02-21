import { Badge } from "@/components/ui/badge";
import { Phone, PhoneMissed, PhoneOff, PhoneForwarded } from "lucide-react";

type CallStatus = "answered" | "missed" | "busy" | "failed";

interface CallStatusBadgeProps {
  status: CallStatus;
}

const statusConfig: Record<CallStatus, { label: string; variant: "default" | "destructive" | "secondary" | "outline"; icon: React.ElementType }> = {
  answered: { label: "Answered", variant: "default", icon: Phone },
  missed: { label: "Missed", variant: "destructive", icon: PhoneMissed },
  busy: { label: "Busy", variant: "secondary", icon: PhoneOff },
  failed: { label: "Failed", variant: "destructive", icon: PhoneOff },
};

export const CallStatusBadge = ({ status }: CallStatusBadgeProps) => {
  const config = statusConfig[status] || statusConfig.missed;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="w-3 h-3" />
      {config.label}
    </Badge>
  );
};

type CallDirection = "inbound" | "outbound" | "internal";

interface CallDirectionBadgeProps {
  direction: CallDirection;
}

const directionConfig: Record<CallDirection, { label: string; className: string }> = {
  inbound: { label: "Inbound", className: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  outbound: { label: "Outbound", className: "bg-green-500/10 text-green-500 border-green-500/20" },
  internal: { label: "Internal", className: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
};

export const CallDirectionBadge = ({ direction }: CallDirectionBadgeProps) => {
  const config = directionConfig[direction] || directionConfig.inbound;

  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
};
