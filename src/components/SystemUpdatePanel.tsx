import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Loader2, GitBranch, Clock3 } from "lucide-react";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

interface VersionInfo {
  hash: string;
  date: string;
  message: string;
  branch: string;
}

interface UpdateStatus {
  running: boolean;
  exitCode: number | null;
  startedAt: string | null;
  lastCompletedAt: string | null;
}

export const SystemUpdatePanel = () => {
  const qc = useQueryClient();

  const { data: version } = useQuery<VersionInfo>({
    queryKey: ["system-version"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/system/version`);
      const j = await r.json();
      return j.data;
    },
    refetchInterval: 30_000,
  });

  const { data: status } = useQuery<UpdateStatus>({
    queryKey: ["system-update-status"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/system/update/status`);
      const j = await r.json();
      return j.data;
    },
    refetchInterval: (q) => (q.state.data?.running ? 1500 : 10000),
  });

  useEffect(() => {
    if (status && !status.running && status.exitCode !== null && status.startedAt) {
      qc.invalidateQueries({ queryKey: ["system-version"] });
      if (status.exitCode === 0) {
        toast.success("System updated successfully.");
      } else {
        toast.error("System update failed. Check server logs.");
      }
    }
  }, [status, qc]);

  const startUpdate = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_URL}/api/system/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to start update");
      return j;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system-update-status"] });
      toast.info("Update started.");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const isRunning = status?.running || startUpdate.isPending;
  const lastUpdate = status?.lastCompletedAt || version?.date || null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            Current Version
          </h3>
          <p className="text-xs text-muted-foreground mt-1">Backend-managed update source</p>
        </div>
        {version ? (
          <div className="text-right shrink-0">
            <Badge variant="secondary" className="font-mono text-xs mb-1">
              {version.hash}
            </Badge>
            <p className="text-xs text-muted-foreground">{version.branch} · {version.date}</p>
          </div>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">Loading…</Badge>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock3 className="w-3.5 h-3.5" />
        <span>Last update:</span>
        <span className="font-mono text-foreground">{lastUpdate || "Never"}</span>
      </div>

      <Button
        onClick={() => startUpdate.mutate()}
        disabled={isRunning}
        className="gap-2"
      >
        {isRunning ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4" />
        )}
        {isRunning ? "Updating…" : "Pull & Update"}
      </Button>
    </div>
  );
};
