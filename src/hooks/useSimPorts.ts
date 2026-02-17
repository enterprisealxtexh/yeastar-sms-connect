import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/integrations/supabase/api-client";

export interface SimPort {
  port: number;
  status: "online" | "offline" | "warning";
  phoneNumber: string;
  signalStrength: number;
  messageCount: number;
  mappedExtension?: string;
}

export interface SimPortConfig {
  id: string;
  port_number: number;
  extension: string | null;
  label: string | null;
  enabled: boolean;
  phone_number: string | null;
  carrier: string | null;
  signal_strength: number | null;
  last_seen_at: string | null;
}

export const useSimPorts = () => {

  return useQuery({
    queryKey: ["sim-ports"],
    queryFn: async (): Promise<{ ports: SimPort[]; configs: SimPortConfig[] }> => {
      // Fetch SIM port configs
      const { data: configs, error: configError } = await apiClient.getPortStatus();

      if (configError) throw configError;

      const configArray = Array.isArray(configs) ? configs : (configs ? [configs] : []);

      // Fetch all SMS messages to count per SIM port
      const { data: messages, error: countError } = await apiClient.getSmsMessages({ limit: 10000 });

      if (countError) throw countError;

      // Count messages per port
      const countsByPort =
        (Array.isArray(messages) ? messages : [])?.reduce(
          (acc, msg) => {
            acc[msg.sim_port] = (acc[msg.sim_port] || 0) + 1;
            return acc;
          },
          {} as Record<number, number>
        ) || {};

      const ports = (configArray || []).map((config) => {
        // Determine status based on enabled state and last_seen_at
        let status: "online" | "offline" | "warning" = "offline";
        if (config.enabled) {
          if (config.last_seen_at) {
            const lastSeen = new Date(config.last_seen_at);
            const now = new Date();
            const diffMinutes = (now.getTime() - lastSeen.getTime()) / (1000 * 60);

            if (diffMinutes < 5) {
              status = config.signal_strength && config.signal_strength < 50 ? "warning" : "online";
            } else if (diffMinutes < 30) {
              status = "warning";
            }
          }
        }

        return {
          port: config.port_number,
          status,
          phoneNumber: config.phone_number || "Not configured",
          signalStrength: config.signal_strength || 0,
          messageCount: countsByPort[config.port_number] || 0,
          mappedExtension: config.extension || undefined,
        };
      });

      return {
        ports,
        configs: (configArray || []).map((c) => ({
          id: c.id,
          port_number: c.port_number,
          extension: c.extension,
          label: c.label,
          enabled: c.enabled,
          phone_number: c.phone_number,
          carrier: c.carrier,
          signal_strength: c.signal_strength,
          last_seen_at: c.last_seen_at,
        })),
      };
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
};
