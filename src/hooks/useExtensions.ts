import { useState, useEffect } from "react";

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

interface ExtensionsResponse {
  success: boolean;
  data?: {
    extensions: Extension[];
    stats?: {
      total: number;
      registered: number;
      unavailable: number;
      offline: number;
    };
  };
  error?: string;
}

export const useExtensions = () => {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExtensions = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/extensions`);
      const data: ExtensionsResponse = await response.json();
      
      if (data.success && data.data?.extensions) {
        setExtensions(data.data.extensions);
      } else {
        setError(data.error || "Failed to fetch extensions");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch extensions");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchExtensions();
    // Refresh every 30 seconds
    const interval = setInterval(fetchExtensions, 30000);
    return () => clearInterval(interval);
  }, []);

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
    error,
    refetch: fetchExtensions,
    getExtensionName,
    getUsername,
  };
};
