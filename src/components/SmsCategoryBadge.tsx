import { Badge } from "@/components/ui/badge";
import { 
  KeyRound, 
  Megaphone, 
  User, 
  Receipt, 
  Bell, 
  AlertTriangle, 
  HelpCircle,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";

export type SmsCategory = "otp" | "marketing" | "personal" | "transactional" | "notification" | "spam" | "unknown";

interface SmsCategoryBadgeProps {
  category: SmsCategory;
  confidence?: number;
  showConfidence?: boolean;
  className?: string;
}

const categoryConfig: Record<SmsCategory, { 
  label: string; 
  icon: React.ComponentType<{ className?: string }>; 
  className: string;
}> = {
  otp: {
    label: "OTP",
    icon: KeyRound,
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30"
  },
  marketing: {
    label: "Marketing",
    icon: Megaphone,
    className: "bg-purple-500/20 text-purple-400 border-purple-500/30"
  },
  personal: {
    label: "Personal",
    icon: User,
    className: "bg-green-500/20 text-green-400 border-green-500/30"
  },
  transactional: {
    label: "Transaction",
    icon: Receipt,
    className: "bg-amber-500/20 text-amber-400 border-amber-500/30"
  },
  notification: {
    label: "Notification",
    icon: Bell,
    className: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
  },
  spam: {
    label: "Spam",
    icon: AlertTriangle,
    className: "bg-red-500/20 text-red-400 border-red-500/30"
  },
  unknown: {
    label: "Unknown",
    icon: HelpCircle,
    className: "bg-muted text-muted-foreground border-border"
  }
};

export const SmsCategoryBadge = ({ 
  category, 
  confidence, 
  showConfidence = false,
  className 
}: SmsCategoryBadgeProps) => {
  const config = categoryConfig[category] || categoryConfig.unknown;
  const Icon = config.icon;

  return (
    <Badge 
      variant="outline" 
      className={cn(
        "text-xs font-medium gap-1 border",
        config.className,
        className
      )}
    >
      <Icon className="w-3 h-3" />
      {config.label}
      {showConfidence && confidence !== undefined && (
        <span className="opacity-70 ml-0.5">
          {Math.round(confidence * 100)}%
        </span>
      )}
    </Badge>
  );
};

export const CategoryLegend = () => {
  const categories = Object.entries(categoryConfig).filter(([key]) => key !== "unknown");
  
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map(([key, config]) => {
        const Icon = config.icon;
        return (
          <div 
            key={key}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border",
              config.className
            )}
          >
            <Icon className="w-3 h-3" />
            {config.label}
          </div>
        );
      })}
    </div>
  );
};
