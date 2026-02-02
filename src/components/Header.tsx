import { Radio, RefreshCw, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "./StatusIndicator";
import { AgentStatusIndicator } from "./AgentStatusIndicator";
import { useAuth, signOut } from "@/hooks/useAuth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface HeaderProps {
  systemStatus: "online" | "offline" | "warning";
  lastSync: string;
  onRefresh: () => void;
}

export const Header = ({ systemStatus, lastSync, onRefresh }: HeaderProps) => {
  const { user, role, isAdmin } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out successfully");
  };

  const getRoleBadgeVariant = () => {
    if (role === "admin") return "default";
    if (role === "operator") return "secondary";
    return "outline";
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Radio className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                SMS Gateway Manager
              </h1>
              <p className="text-xs text-muted-foreground font-mono">
                Yeastar TG400 + S100
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-sm">
            <AgentStatusIndicator />
            <div className="h-4 w-px bg-border" />
            <StatusIndicator status={systemStatus} label="System" />
            <div className="h-4 w-px bg-border" />
            <span className="text-muted-foreground">
              Last sync: <span className="font-mono text-foreground">{lastSync}</span>
            </span>
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
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <User className="w-4 h-4" />
                <span className="hidden md:inline max-w-[120px] truncate">
                  {user?.email?.split("@")[0]}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-1">
                  <span className="truncate">{user?.email}</span>
                  <Badge variant={getRoleBadgeVariant()} className="w-fit text-xs">
                    {role || "user"}
                  </Badge>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};