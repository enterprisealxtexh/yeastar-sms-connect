import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/integrations/supabase/api-client";

export interface AgentStatus {
  isConnected: boolean;
  lastSyncAt: Date | null;
  syncAgeSeconds: number;
  status: "online" | "warning" | "offline";
  agentId: string | null;
  messagesSynced: number;
  errorsCount: number;
  version: string | null;
  hostname: string | null;
}

// Agent is considered:
// - "online" if heartbeat within last 90 seconds (services report every 60s)
// - "warning" if heartbeat within last 3 minutes or recent activity detected
// - "offline" if no activity in over 5 minutes
const ONLINE_THRESHOLD_SECONDS = 90;
const WARNING_THRESHOLD_SECONDS = 180;
const OFFLINE_THRESHOLD_SECONDS = 300;

export const useAgentStatus = () => {

  return useQuery({
    queryKey: ["agent-status"],
    queryFn: async (): Promise<AgentStatus> => {
      try {
        // First check the dedicated heartbeat endpoint
        const { data: heartbeat, error: heartbeatError } = await apiClient.getHeartbeat();

        if (!heartbeatError && heartbeat && !Array.isArray(heartbeat)) {
          // Parse UTC timestamp from database and convert to local time
          const utcString = heartbeat.last_seen_at.replace(' ', 'T') + 'Z';
          const lastSync = new Date(utcString);
          const now = new Date();
          const syncAgeSeconds = Math.floor((now.getTime() - lastSync.getTime()) / 1000);

          let status: "online" | "warning" | "offline";
          if (syncAgeSeconds <= ONLINE_THRESHOLD_SECONDS) {
            status = "online";
          } else if (syncAgeSeconds <= WARNING_THRESHOLD_SECONDS) {
            status = "warning";
          } else if (syncAgeSeconds <= OFFLINE_THRESHOLD_SECONDS) {
            status = "warning"; // Still showing activity within 5 min
          } else {
            status = "offline";
          }

          return {
            isConnected: status !== "offline",
            lastSyncAt: lastSync,
            syncAgeSeconds,
            status,
            agentId: heartbeat.agent_id,
            messagesSynced: heartbeat.messages_synced || 0,
            errorsCount: heartbeat.errors_count || 0,
            version: heartbeat.version,
            hostname: heartbeat.hostname,
          };
        }
      } catch (error) {
        console.debug("Heartbeat check failed:", error);
      }

      // Fallback: check if API server is responding (health check)
      try {
        const healthResult = await apiClient.health();
        if (healthResult) {
          // API is up, check for recent activity
          const { data: logs } = await apiClient.getActivityLogs({ limit: 5 });
          
          const recentActivities = logs?.filter((log: any) => {
            const utcString = log.created_at.replace(' ', 'T') + 'Z';
            const logTime = new Date(utcString);
            const now = new Date();
            const ageSeconds = Math.floor((now.getTime() - logTime.getTime()) / 1000);
            return ageSeconds < OFFLINE_THRESHOLD_SECONDS;
          }) || [];

          if (recentActivities.length > 0) {
            const utcString = recentActivities[0].created_at.replace(' ', 'T') + 'Z';
            const lastSync = new Date(utcString);
            const now = new Date();
            const syncAgeSeconds = Math.floor((now.getTime() - lastSync.getTime()) / 1000);
            
            let status: "online" | "warning" | "offline" = "warning";
            if (syncAgeSeconds <= ONLINE_THRESHOLD_SECONDS) {
              status = "online";
            } else if (syncAgeSeconds <= WARNING_THRESHOLD_SECONDS) {
              status = "warning";
            }

            return {
              isConnected: true,
              lastSyncAt: lastSync,
              syncAgeSeconds,
              status,
              agentId: null,
              messagesSynced: 0,
              errorsCount: 0,
              version: null,
              hostname: null,
            };
          } else {
            // API is up but no recent activity - still show as online if API responds
            return {
              isConnected: true,
              lastSyncAt: null,
              syncAgeSeconds: Infinity,
              status: "online", // API server is responding = system is available
              agentId: null,
              messagesSynced: 0,
              errorsCount: 0,
              version: "Unknown",
              hostname: null,
            };
          }
        }
      } catch (error) {
        console.debug("Health check failed:", error);
      }

      // Completely offline - API not responding
      return {
        isConnected: false,
        lastSyncAt: null,
        syncAgeSeconds: Infinity,
        status: "offline",
        agentId: null,
        messagesSynced: 0,
        errorsCount: 0,
        version: null,
        hostname: null,
      };
    },
    refetchInterval: 30000, // Check every 30 seconds
  });
};
