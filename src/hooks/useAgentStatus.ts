import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

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
// - "online" if heartbeat within last 2 minutes
// - "warning" if heartbeat within last 5 minutes
// - "offline" if no heartbeat in over 5 minutes
const ONLINE_THRESHOLD_SECONDS = 120;
const WARNING_THRESHOLD_SECONDS = 300;

export const useAgentStatus = () => {
  const queryClient = useQueryClient();

  // Subscribe to realtime changes on agent_heartbeat
  useEffect(() => {
    const channel = supabase
      .channel("agent-heartbeat-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_heartbeat",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["agent-status"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["agent-status"],
    queryFn: async (): Promise<AgentStatus> => {
      // First check the dedicated heartbeat table
      const { data: heartbeat, error: heartbeatError } = await supabase
        .from("agent_heartbeat")
        .select("*")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!heartbeatError && heartbeat) {
        const lastSync = new Date(heartbeat.last_seen_at);
        const now = new Date();
        const syncAgeSeconds = Math.floor((now.getTime() - lastSync.getTime()) / 1000);

        let status: "online" | "warning" | "offline";
        if (syncAgeSeconds <= ONLINE_THRESHOLD_SECONDS) {
          status = "online";
        } else if (syncAgeSeconds <= WARNING_THRESHOLD_SECONDS) {
          status = "warning";
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

      // Fallback: check activity logs for any agent activity
      const { data: logs } = await supabase
        .from("activity_logs")
        .select("created_at, event_type, message")
        .or("event_type.eq.agent_poll,event_type.eq.sms_received,event_type.eq.agent_sync,event_type.eq.sms_sync")
        .order("created_at", { ascending: false })
        .limit(1);

      const lastSync = logs?.[0]?.created_at ? new Date(logs[0].created_at) : null;
      const now = new Date();
      const syncAgeSeconds = lastSync 
        ? Math.floor((now.getTime() - lastSync.getTime()) / 1000) 
        : Infinity;

      let status: "online" | "warning" | "offline";
      if (syncAgeSeconds <= ONLINE_THRESHOLD_SECONDS) {
        status = "online";
      } else if (syncAgeSeconds <= WARNING_THRESHOLD_SECONDS) {
        status = "warning";
      } else {
        status = "offline";
      }

      return {
        isConnected: status !== "offline",
        lastSyncAt: lastSync,
        syncAgeSeconds,
        status,
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
