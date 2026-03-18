import { useQuery } from "@tanstack/react-query";
import { gatewayApi } from "@/lib/api-client";

export interface PortLabel {
  port_number: number;
  label: string | null;
  enabled: boolean;
}

export const usePortLabels = () => {
  return useQuery({
    queryKey: ['port-labels'],
    queryFn: async (): Promise<Record<number, PortLabel>> => {
      const gsmSpans = await gatewayApi.gsmSpans();
      const portMap: Record<number, PortLabel> = {};
      gsmSpans.forEach((span: any) => {
        const portNumber = span.gsm_span - 1;
        portMap[portNumber] = {
          port_number: portNumber,
          label: span.name || `Port ${portNumber}`,
          enabled: span.is_active === 1,
        };
      });
      return portMap;
    },
    staleTime: 60000,
    refetchInterval: 120000,
    retry: 1,
  });
};

export const getPortLabel = (portNumber: number, portLabels: Record<number, PortLabel> | undefined): string => {
  if (!portLabels || !portLabels[portNumber]) return `Port ${portNumber}`;
  return portLabels[portNumber].label || `Port ${portNumber}`;
};

