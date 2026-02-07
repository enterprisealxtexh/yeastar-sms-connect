import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { SimPortCard } from "@/components/SimPortCard";
import { SystemStatusCard } from "@/components/SystemStatusCard";
import { SmsInbox } from "@/components/SmsInbox";
import { ActivityLog } from "@/components/ActivityLog";
import { ConfigurationPanel } from "@/components/ConfigurationPanel";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import { CallRecordsTable } from "@/components/CallRecordsTable";
import { CallStatsCards } from "@/components/CallStatsCards";
import { QuickDialWidget } from "@/components/QuickDialWidget";
import { CallQueueStatus } from "@/components/CallQueueStatus";
import { ErrorLogsPanel } from "@/components/ErrorLogsPanel";
import { AiConfigPanel } from "@/components/AiConfigPanel";
import { TelegramPanel } from "@/components/TelegramPanel";
import { ContactsPanel } from "@/components/ContactsPanel";
import { PredictiveMaintenancePanel } from "@/components/PredictiveMaintenancePanel";
import { AiAutomationPanel } from "@/components/AiAutomationPanel";
import { DashboardSidebar, DashboardTab } from "@/components/DashboardSidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, Phone, Database } from "lucide-react";
import { toast } from "sonner";
import { useSimPorts } from "@/hooks/useSimPorts";
import { useSmsMessages } from "@/hooks/useSmsMessages";
import { useActivityLogs } from "@/hooks/useActivityLogs";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useCallRecords, useCallStats } from "@/hooks/useCallRecords";

const Index = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DashboardTab>("dashboard");
  const [lastSync, setLastSync] = useState(() => new Date().toLocaleString("sv-SE").replace(",", ""));

  const { data: simData, isLoading: simLoading } = useSimPorts();
  const simPorts = simData?.ports || [];
  const simConfigs = simData?.configs || [];
  const { data: messages = [], isLoading: messagesLoading } = useSmsMessages();
  const { data: logs = [], isLoading: logsLoading } = useActivityLogs();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: calls = [], isLoading: callsLoading } = useCallRecords();
  const { data: callStats, isLoading: callStatsLoading } = useCallStats();

  const handleRefresh = async () => {
    await queryClient.invalidateQueries();
    const now = new Date().toLocaleString("sv-SE").replace(",", "");
    setLastSync(now);
    toast.success("System data refreshed");
  };

  const systemStatus = simPorts.some((p) => p.status === "online")
    ? "online"
    : simPorts.some((p) => p.status === "warning")
    ? "warning"
    : "offline";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header systemStatus={systemStatus} lastSync={lastSync} onRefresh={handleRefresh} />

      <div className="flex flex-1 overflow-hidden">
        <DashboardSidebar activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "dashboard" && (
            <>
              {/* System Status Row */}
              <div className="grid gap-4 md:grid-cols-3">
                <SystemStatusCard
                  title="TG400 Gateway"
                  status={systemStatus}
                  statusLabel={systemStatus === "online" ? "Connected" : systemStatus === "warning" ? "Degraded" : "Disconnected"}
                  icon={Server}
                  details={[
                    { label: "Active SIMs", value: statsLoading ? "..." : `${stats?.activeSims || 0}/${stats?.totalSims || 0}` },
                    { label: "Last Poll", value: lastSync.split(" ")[1] || lastSync },
                  ]}
                />
                <SystemStatusCard
                  title="S100 PBX"
                  status="online"
                  statusLabel="Connected"
                  icon={Phone}
                  details={[
                    { label: "Extensions", value: "Configured" },
                    { label: "SMS Queue", value: statsLoading ? "..." : `${stats?.unreadMessages || 0} pending` },
                  ]}
                />
                <SystemStatusCard
                  title="Message Store"
                  status="online"
                  statusLabel="Healthy"
                  icon={Database}
                  details={[
                    { label: "Total Messages", value: statsLoading ? "..." : stats?.totalMessages.toLocaleString() || "0" },
                    { label: "Unread", value: statsLoading ? "..." : stats?.unreadMessages.toLocaleString() || "0" },
                  ]}
                />
              </div>

              {/* SIM Ports Row */}
              <div>
                <h2 className="text-sm font-medium text-muted-foreground mb-4">SIM Port Status</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {simLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-[180px] rounded-lg" />
                    ))
                  ) : (
                    simPorts.map((sim) => <SimPortCard key={sim.port} {...sim} />)
                  )}
                </div>
              </div>

              {/* Messages and Logs Row */}
              <div className="grid gap-6 lg:grid-cols-2">
                {messagesLoading ? (
                  <Skeleton className="h-[400px] rounded-lg" />
                ) : (
                  <SmsInbox messages={messages} />
                )}
                {logsLoading ? (
                  <Skeleton className="h-[300px] rounded-lg" />
                ) : (
                  <ActivityLog logs={logs} />
                )}
              </div>
            </>
          )}

          {activeTab === "calls" && (
            <>
              <CallStatsCards stats={callStats} isLoading={callStatsLoading} />
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <CallRecordsTable calls={calls} isLoading={callsLoading} />
                </div>
                <div className="space-y-6">
                  <QuickDialWidget />
                  <CallQueueStatus />
                </div>
              </div>
            </>
          )}

          {activeTab === "analytics" && <AnalyticsDashboard />}

          {activeTab === "logs" && (
            logsLoading ? (
              <Skeleton className="h-[400px] rounded-lg" />
            ) : (
              <ActivityLog logs={logs} />
            )
          )}

          {activeTab === "config" && (
            <ConfigurationPanel
              simPorts={simConfigs}
              isLoading={simLoading}
              onConfigSaved={() => {
                queryClient.invalidateQueries({ queryKey: ["sim-ports"] });
              }}
            />
          )}

          {activeTab === "ai" && (
            <>
              <AiAutomationPanel />
              <PredictiveMaintenancePanel />
              <div className="grid gap-6 lg:grid-cols-2">
                <ErrorLogsPanel />
                <AiConfigPanel />
              </div>
            </>
          )}

          {activeTab === "telegram" && <TelegramPanel />}

          {activeTab === "contacts" && <ContactsPanel />}
        </main>
      </div>
    </div>
  );
};

export default Index;
