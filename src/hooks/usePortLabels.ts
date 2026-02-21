import { useQuery } from "@tanstack/react-query";

export interface PortLabel {
  port_number: number;
  label: string | null;
  enabled: boolean;
}

export const usePortLabels = () => {
  return useQuery({
    queryKey: ["port-labels"],
    queryFn: async (): Promise<Record<number, PortLabel>> => {
      const apiUrl = import.meta.env.VITE_API_URL;

      const response = await fetch(`${apiUrl}/api/sim-ports`);
      if (!response.ok) throw new Error("Failed to fetch port labels");

      const data = await response.json();
      const ports = data.data || [];

      // Convert array to object keyed by internal port number (1-4)
      // API endpoint already normalizes to internal port numbers
      const portMap: Record<number, PortLabel> = {};
      ports.forEach((port: any) => {
        portMap[port.port_number] = {
          port_number: port.port_number,
          label: port.label || null,
          enabled: port.enabled,
        };
      });

      return portMap;
    },
    refetchInterval: false, // Manual refresh only
  });
};

export const getPortLabel = (portNumber: number, portLabels: Record<number, PortLabel> | undefined): string => {
  if (!portLabels || !portLabels[portNumber]) {
    return ''; // No label set - never show "SIM X"
  }
  return portLabels[portNumber].label || ''; // Return label or empty string - never show "SIM X"
};

