import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { SystemFooter } from "@/components/SystemFooter";
import { SystemStatusCard } from "@/components/SystemStatusCard";
import { SmsInbox } from "@/components/SmsInbox";
import { ActivityLog } from "@/components/ActivityLog";
import { CallsSummaryPanel } from "@/components/CallsSummaryPanel";
import { RoleManagementPanel } from "@/components/RoleManagementPanel";
import { UserProfilePanel } from "@/components/UserProfilePanel";
import { ConfigurationPanel } from "@/components/ConfigurationPanel";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import { InsightsPanel } from "@/components/InsightsPanel";
import { CallRecordsTable } from "@/components/CallRecordsTable";
import { CallStatsCards } from "@/components/CallStatsCards";
import { QuickDialWidget } from "@/components/QuickDialWidget";
import { CallQueueStatus } from "@/components/CallQueueStatus";
import { ErrorLogsPanel } from "@/components/ErrorLogsPanel";
import { ContactsPanel } from "@/components/ContactsPanel";
import { CallsContactsTab } from "@/components/CallsContactsTab";
import { AllSmsPanel } from "@/components/AllSmsPanel";
import { StaffPanel } from "@/components/StaffPanel";

import { DashboardSidebar, DashboardTab } from "@/components/DashboardSidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, Phone, Database, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { useSmsMessages } from "@/hooks/useSmsMessages";
import { useActivityLogs } from "@/hooks/useActivityLogs";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { usePbxConfig } from "@/hooks/usePbxConfig";
import { usePbxStatus } from "@/hooks/usePbxStatus";
import { useGatewayStatus } from "@/hooks/useGatewayStatus";
import { useCallRecords, useCallStats, useAllTimeCallStats } from "@/hooks/useCallRecords";
import { useAuth } from "@/hooks/useAuth";
import { useUserPermissions } from "@/hooks/useUserPermissions";
import { formatDateNairobi } from "@/lib/dateUtils";

const Index = () => {
  const queryClient = useQueryClient();
  const { role, isAdmin } = useAuth();
  const { data: permissions } = useUserPermissions();
  const isViewer = role === "viewer";
  
  // Initialize activeTab from localStorage, default to "dashboard"
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    const saved = localStorage.getItem("activeTab");
    if (saved === "extensions") {
      return "config";
    }

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

  // Apply viewer port/extension restrictions client-side
  const viewerPorts = permissions?.ports ?? [];
  const viewerExtensions = permissions?.extensions ?? [];

  // Lock viewer's extension filter to their assigned extension (server-side filtering)
  useEffect(() => {
    if (isViewer && viewerExtensions.length > 0) {
      setCallRecordsExtensionFilter(viewerExtensions[0]);
      setCallRecordsPage(1);
    }
  }, [isViewer, viewerExtensions.join(',')]);

  const filteredMessages = useMemo(() => {
    if (!isViewer || viewerPorts.length === 0) return messages;
    return messages.filter((m: any) => viewerPorts.includes(m.simPort));
  }, [messages, isViewer, viewerPorts]);

  // For calls, server handles filtering via callRecordsExtensionFilter (locked for viewers)
  // No client-side call filtering needed
  // Reset to page 1 when any filter changes
  useEffect(() => {
    setCallRecordsPage(1);
  }, [callRecordsExtensionFilter, callRecordsDirectionFilter, callRecordsStatusFilter]);

  const viewerExtForStats = isViewer && viewerExtensions.length > 0 ? viewerExtensions[0] : undefined;
  const { data: callStats, isLoading: callStatsLoading } = useCallStats(viewerExtForStats);
  const { data: allTimeCallStats, isLoading: allTimeCallStatsLoading } = useAllTimeCallStats(viewerExtForStats);
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
  
  const pbxStatusValue = pbxStatus?.connected
    ? "online"
    : pbxStatus?.configured
    ? "warning"
    : "offline";
  const pbxStatusLabel = pbxStatus?.connected
    ? "Connected"
    : pbxStatus?.configured
    ? `Configured (${pbxStatus?.error || "Connection failed"})`
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
              {/* System Status Row - Admin/SuperAdmin Only */}
              {isAdmin && (
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
              )}
              {!isAdmin && (
                <Card className="border-border/50 bg-muted/30">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-center gap-3 text-muted-foreground">
                      <Lock className="w-5 h-5" />
                      <p className="text-sm font-medium">System status hidden. This section is only visible to administrators.</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Messages and Logs Row */}
              <div className="grid gap-6 lg:grid-cols-2">
                {messagesLoading ? (
                  <Skeleton className="h-[400px] rounded-lg" />
                ) : (
                  <SmsInbox messages={filteredMessages} />
                )}
                <div className="flex flex-col gap-6">
                  {callsLoading ? (
                    <Skeleton className="h-[200px] rounded-lg" />
                  ) : (
                    <CallsSummaryPanel calls={calls} />
                  )}
                  {(!isViewer && !logsLoading) && (
                    <ActivityLog logs={logs} />
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === "calls" && (
            <CallsContactsTab
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
              allTimeStats={allTimeCallStats}
              todayStats={callStats}
              statsLoading={allTimeCallStatsLoading || callStatsLoading}
              isViewer={isViewer}
            />
          )}

          {activeTab === "analytics" && <InsightsPanel role={role} permissions={permissions} />}

          {activeTab === "roles" && (
            <RoleManagementPanel />
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
          {activeTab === "staff" && <StaffPanel />}
          </main>

          <SystemFooter lastSync={lastSync} onRefresh={handleRefresh} />
        </div>
      </div>
    </div>
  );
};

export default Index;
