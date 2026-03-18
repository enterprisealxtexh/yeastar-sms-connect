import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import { ActivityLog } from "@/components/ActivityLog";
import { AiAutomationPanel } from "./AiAutomationPanel";
import { PredictiveMaintenancePanel } from "@/components/PredictiveMaintenancePanel";
import { ErrorLogsPanel } from "@/components/ErrorLogsPanel";
import { AiConfigPanel } from "@/components/AiConfigPanel";
import { TelegramPanel } from "./TelegramPanel";
import { MissedCallsReportPanel } from "./MissedCallsReportPanel";
import { useActivityLogs } from "@/hooks/useActivityLogs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { BarChart3, FileText, ScrollText, BrainCircuit, Send } from "lucide-react";
import type { AppRole } from "@/hooks/useAuth";
import type { UserPermissions } from "@/hooks/useUserPermissions";

type Section = "analytics" | "reports" | "logs" | "ai" | "telegram";

interface SectionItem {
  id: Section;
  label: string;
  icon: React.ElementType;
}

const allSections: SectionItem[] = [
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "ai", label: "AI & Diagnostics", icon: BrainCircuit },
  { id: "telegram", label: "Telegram", icon: Send },
];

// Sections viewers are NOT allowed to see
const VIEWER_HIDDEN_SECTIONS: Section[] = ["logs", "ai", "telegram"];

interface InsightsPanelProps {
  role?: AppRole | null;
  permissions?: UserPermissions;
}

export const InsightsPanel = ({ role, permissions }: InsightsPanelProps) => {
  const isViewer = role === "viewer";
  const sections = isViewer
    ? allSections.filter(s => !VIEWER_HIDDEN_SECTIONS.includes(s.id))
    : allSections;

  const [active, setActive] = useState<Section>("analytics");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const { data: logs = [], isLoading: logsLoading } = useActivityLogs();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {sections.map(s => (
          <Button
            key={s.id}
            variant={active === s.id ? "default" : "outline"}
            size="sm"
            className={cn("gap-2", active === s.id && "shadow-md")}
            onClick={() => setActive(s.id)}
          >
            <s.icon className="w-4 h-4" />
            {s.label}
          </Button>
        ))}
      </div>

      <div className="min-h-[400px]">
        {active === "analytics" && <AnalyticsDashboard dateFrom={dateFrom} dateTo={dateTo} onDateChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />}
        {active === "reports" && <MissedCallsReportPanel dateFrom={dateFrom} dateTo={dateTo} onDateChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />}
        {active === "logs" && (
          logsLoading ? <Skeleton className="h-[s400px] rounded-lg" /> : <ActivityLog logs={logs} />
        )}
        {active === "ai" && (
          <div className="space-y-4">
            <AiAutomationPanel />
            <PredictiveMaintenancePanel />
            <div className="grid gap-4 lg:grid-cols-2">
              <ErrorLogsPanel />
              <AiConfigPanel />
            </div>
          </div>
        )}
        {active === "telegram" && <TelegramPanel />}
      </div>
    </div>
  );
};
