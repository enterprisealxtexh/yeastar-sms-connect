import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { SystemFooter } from "@/components/SystemFooter";
import { SystemStatusCard } from "@/components/SystemStatusCard";
import { SmsInbox } from "@/components/SmsInbox";
import { ActivityLog } from "@/components/ActivityLog";
import { CallsSummaryPanel } from "@/components/CallsSummaryPanel";
import { UserManager } from "@/components/UserManager";
import { UserProfilePanel } from "@/components/UserProfilePanel";
import { ConfigurationPanel } from "@/components/ConfigurationPanel";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import { CallRecordsTable } from "@/components/CallRecordsTable";
import { CallStatsCards } from "@/components/CallStatsCards";
import { QuickDialWidget } from "@/components/QuickDialWidget";
import { CallQueueStatus } from "@/components/CallQueueStatus";
import { ErrorLogsPanel } from "@/components/ErrorLogsPanel";
import { ContactsPanel } from "@/components/ContactsPanel";
import ExtensionsPanel from "@/components/ExtensionsPanel";
import { AllSmsPanel } from "@/components/AllSmsPanel";

import { DashboardSidebar, DashboardTab } from "@/components/DashboardSidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, Phone, Database } from "lucide-react";
import { toast } from "sonner";
import { useSmsMessages } from "@/hooks/useSmsMessages";
import { useActivityLogs } from "@/hooks/useActivityLogs";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { usePbxConfig } from "@/hooks/usePbxConfig";
import { usePbxStatus } from "@/hooks/usePbxStatus";
import { useGatewayStatus } from "@/hooks/useGatewayStatus";
import { useCallRecords, useCallStats, useAllTimeCallStats } from "@/hooks/useCallRecords";
import { formatDateNairobi } from "@/lib/dateUtils";

const Index = () => {
  const queryClient = useQueryClient();
  
  // Initialize activeTab from localStorage, default to "dashboard"
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    const saved = localStorage.getItem("activeTab");
    return (saved as DashboardTab) || "dashboard";
  });
  
  // Save activeTab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("activeTab", activeTab);
  }, [activeTab]);

  // Mobile menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const [lastSync, setLastSync] = useState(() => formatDateNairobi());
  const [callRecordsPage, setCallRecordsPage] = useState(1);
  const [callRecordsExtensionFilter, setCallRecordsExtensionFilter] = useState<string>("all");
  const [callRecordsDirectionFilter, setCallRecordsDirectionFilter] = useState<string>("all");
  const [callRecordsStatusFilter, setCallRecordsStatusFilter] = useState<string>("all");

  const { data: messages = [], isLoading: messagesLoading } = useSmsMessages();
  const { data: logs = [], isLoading: logsLoading } = useActivityLogs();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: callsResponse, isLoading: callsLoading } = useCallRecords(callRecordsPage, 50, callRecordsExtensionFilter, callRecordsDirectionFilter, callRecordsStatusFilter);
  const calls = callsResponse?.data || [];
  const callsPagination = callsResponse?.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 1 };
  // Reset to page 1 when any filter changes
  useEffect(() => {
    setCallRecordsPage(1);
  }, [callRecordsExtensionFilter, callRecordsDirectionFilter, callRecordsStatusFilter]);  const { data: callStats, isLoading: callStatsLoading } = useCallStats();
  const { data: allTimeCallStats, isLoading: allTimeCallStatsLoading } = useAllTimeCallStats();
  const { config: pbxConfig } = usePbxConfig();
  const { data: pbxStatus } = usePbxStatus();
  const { data: gatewayStatus } = useGatewayStatus();

  // Determine gateway status based on actual connection
  const gatewayStatusValue = gatewayStatus?.connected
    ? "online"
    : gatewayStatus?.configured
    ? "warning"
    : "offline";
  const gatewayStatusLabel = gatewayStatus?.connected
    ? "Connected"
    : gatewayStatus?.configured
    ? "Configured (Connecting...)"
    : "Not Configured";
  
  // Determine PBX status - only show connected if we have actual IP configured
  const pbxStatusValue = pbxStatus?.configured && pbxStatus?.pbx_ip ? "online" : "offline";
  const pbxStatusLabel = pbxStatus?.configured && pbxStatus?.pbx_ip 
    ? "Connected" 
    : pbxStatus?.configured 
    ? "Configured (No IP)"
    : "Not Configured";

  const handleRefresh = async () => {
    await queryClient.invalidateQueries();
    const now = formatDateNairobi();
    setLastSync(now);
    toast.success("System data refreshed");
  };

  return (
    <div className="h-screen bg-background flex flex-col">
      <Header 
        onProfileClick={() => setActiveTab("profile")} 
        onMenuClick={() => setMobileMenuOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        <DashboardSidebar 
          activeTab={activeTab} 
          onTabChange={(tab) => {
            setActiveTab(tab);
            setMobileMenuOpen(false);
          }}
          mobileMenuOpen={mobileMenuOpen}
          onMobileMenuOpenChange={setMobileMenuOpen}
        />

        <div className="flex flex-col flex-1">
          <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "dashboard" && (
            <>
              {/* System Status Row */}
              <div className="grid gap-4 md:grid-cols-3">
                <SystemStatusCard
                  title="TG400 Gateway"
                  status={gatewayStatusValue as "online" | "warning" | "offline"}
                  statusLabel={gatewayStatusLabel}
                  icon={Server}
                  details={[
                    { label: "Gateway IP", value: gatewayStatus?.gateway_ip || "Not configured" },
                    { label: "Port", value: String(gatewayStatus?.gateway_port) || "—" },
                    { label: "Available Ports", value: stats?.availablePorts ? `${stats.availablePorts.join(", ")}` : "—" },
                    { label: "Active SIMs", value: statsLoading ? "..." : `${stats?.activeSims || 0}/${stats?.totalSims || 0}` },
                  ]}
                />
                <SystemStatusCard
                  title="S100 PBX"
                  status={pbxStatusValue as "online" | "warning" | "offline"}
                  statusLabel={pbxStatusLabel}
                  icon={Phone}
                  details={[
                    { label: "PBX IP", value: pbxStatus?.pbx_ip || "Not configured" },
                    { label: "Port", value: String(pbxStatus?.pbx_port) || "—" },
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

              {/* Messages and Logs Row */}
              <div className="grid gap-6 lg:grid-cols-2">
                {messagesLoading ? (
                  <Skeleton className="h-[400px] rounded-lg" />
                ) : (
                  <SmsInbox messages={messages} />
                )}
                <div className="flex flex-col gap-6">
                  {callsLoading ? (
                    <Skeleton className="h-[200px] rounded-lg" />
                  ) : (
                    <CallsSummaryPanel calls={calls} />
                  )}
                  {logsLoading ? (
                    <Skeleton className="h-[200px] rounded-lg" />
                  ) : (
                    <ActivityLog logs={logs} />
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === "calls" && (
            <>
              <CallStatsCards 
                allTimeStats={allTimeCallStats} 
                todayStats={callStats}
                isLoading={allTimeCallStatsLoading || callStatsLoading} 
              />
              <CallRecordsTable 
                calls={calls} 
                isLoading={callsLoading}
                currentPage={callRecordsPage}
                totalPages={callsPagination.totalPages}
                totalCount={callsPagination.total}
                onPageChange={setCallRecordsPage}
                extensionFilter={callRecordsExtensionFilter}
                onExtensionFilterChange={setCallRecordsExtensionFilter}
                directionFilter={callRecordsDirectionFilter}
                onDirectionFilterChange={setCallRecordsDirectionFilter}
                statusFilter={callRecordsStatusFilter}
                onStatusFilterChange={setCallRecordsStatusFilter}
              />
            </>
          )}

          {activeTab === "analytics" && <AnalyticsDashboard />}

          {activeTab === "logs" && (
            logsLoading ? (
              <Skeleton className="h-[400px] rounded-lg" />
            ) : (
              <ActivityLog logs={logs} isFullPage={true} />
            )
          )}

          {activeTab === "users" && (
            <UserManager />
          )}

          {activeTab === "profile" && (
            <UserProfilePanel />
          )}

          {activeTab === "config" && (
            <ConfigurationPanel
              onConfigSaved={() => {
                queryClient.invalidateQueries({ queryKey: ["sim-ports"] });
              }}
            />
          )}

          {activeTab === "messages" && <AllSmsPanel />}
          {activeTab === "contacts" && <ContactsPanel />}
          {activeTab === "extensions" && <ExtensionsPanel />}
          </main>

          <SystemFooter lastSync={lastSync} onRefresh={handleRefresh} />
        </div>
      </div>
    </div>
  );
};

export default Index;
