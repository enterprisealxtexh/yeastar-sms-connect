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

      try {
        // Fetch from new gsm_span_config endpoint
        const response = await fetch(`${apiUrl}/api/gsm-spans`);
        if (!response.ok) throw new Error("Failed to fetch GSM spans");

        const data = await response.json();
        const gsmSpans = data.data || [];

        // Convert to port-based map: GsmSpan (2-5) -> Port (1-4)
        const portMap: Record<number, PortLabel> = {};
        gsmSpans.forEach((span: any) => {
          const portNumber = span.gsm_span - 1;  // Convert GsmSpan to Port
          portMap[portNumber] = {
            port_number: portNumber,
            label: span.name || `Port ${portNumber}`,  // Use name from DB or fallback
            enabled: span.is_active === 1,  // Port enabled if active
          };
        });

        return portMap;
      } catch (error) {
        console.error('Failed to fetch port labels:', error);
        return {};
      }
    },
    staleTime: 60000, // 60 second stale time for static config
    refetchInterval: 120000, // 2 minute refresh - config rarely changes
    retry: 1, // Reduced from 2 to 1
  });
};

export const getPortLabel = (portNumber: number, portLabels: Record<number, PortLabel> | undefined): string => {
  if (!portLabels || !portLabels[portNumber]) {
    return `Port ${portNumber}`; // Fallback to port number
  }
  return portLabels[portNumber].label || `Port ${portNumber}`; // Return label or fallback
};

