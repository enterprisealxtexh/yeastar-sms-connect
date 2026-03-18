import { useQuery } from "@tanstack/react-query";
import { gatewayApi } from "@/lib/api-client";

export interface Extension {
  extnumber: string;
  username: string;
  status: string;
  type: string;
  callerid?: string;
  registername?: string;
  mobile?: string;
  email?: string;
  language?: string;
  hasvoicemail?: string;
  alwaysforward?: string;
  noanswerforward?: string;
  busyforward?: string;
  ringtimeout?: string;
  outroute?: string;
  dnd?: string;
  nat?: string;
}

export const useExtensions = () => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['extensions'],
    queryFn: async () => {
      const resp = await gatewayApi.extensions();
      return (resp?.extensions || []) as Extension[];
    },
    refetchInterval: 30000,
    staleTime: 15000,
    retry: 1,
  });

  const extensions = data || [];

  const getExtensionName = (extnumber: string): string => {
    const ext = extensions.find((e) => e.extnumber === extnumber);
    return ext ? `${ext.extnumber} - ${ext.username}` : extnumber;
  };

  const getUsername = (extnumber: string): string | undefined => {
    const ext = extensions.find((e) => e.extnumber === extnumber);
    return ext?.username;
  };

  return {
    extensions,
    isLoading,
    error: error ? (error as Error).message : null,
    refetch,
    getExtensionName,
    getUsername,
  };
};
