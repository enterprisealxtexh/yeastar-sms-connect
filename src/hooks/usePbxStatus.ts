import { useQuery } from "@tanstack/react-query";

export interface PbxStatus {
  configured: boolean;
  pbx_ip: string | null;
  pbx_port: number | null;
  timestamp: string;
}

export const usePbxStatus = () => {
  return useQuery({
    queryKey: ["pbx-status"],
    queryFn: async () => {
      const apiUrl = import.meta.env.VITE_API_URL;
      try {
        const response = await fetch(`${apiUrl}/api/pbx-status`);
        if (!response.ok) throw new Error("Failed to fetch PBX status");
        const data = await response.json();
        return data as PbxStatus;
      } catch (error) {
        console.error("Error fetching PBX status:", error);
        // Return default offline status instead of throwing
        return {
          configured: false,
          pbx_ip: null,
          pbx_port: null,
          timestamp: new Date().toISOString(),
        } as PbxStatus;
      }
    },
    refetchInterval: 30000, // Reduced from 5 to 30 seconds
    staleTime: 15000, // 15 second stale time
    retry: 1, // Reduced from 2 to 1
  });
};
