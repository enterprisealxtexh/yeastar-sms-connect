import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SystemFooterProps {
  lastSync: string;
  onRefresh: () => void;
}

export const SystemFooter = ({ lastSync, onRefresh }: SystemFooterProps) => {
  return (
    <footer className="border-t border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Last sync:</span>
          <span className="font-mono text-foreground">{lastSync}</span>
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
