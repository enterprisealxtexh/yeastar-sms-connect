import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  PhoneCall,
  BarChart3,
  FileText,
  Settings,
  Brain,
  Send,
  Users,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type DashboardTab =
  | "dashboard"
  | "calls"
  | "analytics"
  | "logs"
  | "config"
  | "ai"
  | "telegram"
  | "contacts";

interface NavItem {
  id: DashboardTab;
  label: string;
  icon: React.ElementType;
}

const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "calls", label: "Calls", icon: PhoneCall },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "logs", label: "Logs", icon: FileText },
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "telegram", label: "Telegram", icon: Send },
  { id: "ai", label: "AI & Diagnostics", icon: Brain },
  { id: "config", label: "Configuration", icon: Settings },
];

interface DashboardSidebarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}

export const DashboardSidebar = ({ activeTab, onTabChange }: DashboardSidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "sticky top-0 h-screen flex flex-col border-r border-border/50 bg-sidebar transition-all duration-200 shrink-0",
          collapsed ? "w-[60px]" : "w-[200px]"
        )}
      >
        {/* Collapse toggle */}
        <div className={cn("flex items-center p-2", collapsed ? "justify-center" : "justify-end")}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 flex flex-col gap-1 px-2">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            const button = (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "flex items-center gap-3 w-full rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-0"
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent side="right" className="bg-popover text-popover-foreground border-border">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return button;
          })}
        </nav>
      </aside>
    </TooltipProvider>
  );
};
