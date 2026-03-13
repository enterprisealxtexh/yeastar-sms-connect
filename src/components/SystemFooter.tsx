import { RefreshCw, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

interface SystemFooterProps {
  lastSync: string;
  onRefresh: () => void;
}

export const SystemFooter = ({ lastSync, onRefresh }: SystemFooterProps) => {
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";

  const { data: updateCheck } = useQuery({
    queryKey: ["system-update-check-footer"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/system/update/check`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to check updates");
      return json.data as { configured: boolean; updateAvailable: boolean };
    },
    enabled: isSuperAdmin,
    refetchInterval: 60000,
    retry: 0,
  });

  return (
    <footer className="border-t border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Last sync:</span>
          <span className="font-mono text-foreground">{lastSync}</span>
          {isSuperAdmin && updateCheck?.updateAvailable && (
            <Badge variant="destructive" className="gap-1 text-[11px]">
              <BellRing className="w-3 h-3" />
              Update available
            </Badge>
          )}
        </div>
        
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          className="gap-2 border-border/50 hover:bg-muted/50"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>
    </footer>
  );
};
