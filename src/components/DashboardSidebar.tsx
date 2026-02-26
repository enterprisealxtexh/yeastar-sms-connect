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
  Phone,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";

export type DashboardTab =
  | "dashboard"
  | "calls"
  | "analytics"
  | "logs"
  | "config"
  | "users"
  | "profile"
  | "messages"
  | "extensions"
  | "contacts";

interface NavItem {
  id: DashboardTab;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "messages", label: "Messages", icon: FileText },
  { id: "calls", label: "Calls", icon: PhoneCall },
  { id: "contacts", label: "Contacts", icon: User },
  { id: "extensions", label: "Extensions", icon: Phone, adminOnly: true },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "logs", label: "Logs", icon: FileText },
  { id: "users", label: "Users", icon: Users, adminOnly: true },
  { id: "config", label: "Configuration", icon: Settings, adminOnly: true },
];

interface DashboardSidebarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  mobileMenuOpen?: boolean;
  onMobileMenuOpenChange?: (open: boolean) => void;
}

const NavItems = ({
  activeTab,
  onTabChange,
  collapsed,
  isAdmin,
  onItemClick,
}: {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  collapsed: boolean;
  isAdmin: boolean;
  onItemClick?: () => void;
}) => (
  <nav className="flex-1 flex flex-col gap-1 px-2">
    {navItems
      .filter((item) => !item.adminOnly || isAdmin)
      .map((item) => {
      const isActive = activeTab === item.id;
      const button = (
        <button
          key={item.id}
          onClick={() => {
            onTabChange(item.id);
            onItemClick?.();
          }}
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
);

export const DashboardSidebar = ({ 
  activeTab, 
  onTabChange, 
  mobileMenuOpen = false,
  onMobileMenuOpenChange 
}: DashboardSidebarProps) => {
  const isMobile = useIsMobile();
  const { isAdmin } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  // Close mobile drawer on resize to desktop
  useEffect(() => {
    if (!isMobile && mobileMenuOpen) {
      onMobileMenuOpenChange?.(false);
    }
  }, [isMobile, mobileMenuOpen, onMobileMenuOpenChange]);

  // Mobile: sheet drawer
  if (isMobile) {
    return (
      <Sheet open={mobileMenuOpen} onOpenChange={onMobileMenuOpenChange}>
        <SheetContent side="left" className="w-[240px] p-0 bg-sidebar border-border/50">
          <div className="flex items-center justify-between p-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground">Navigation</span>
          </div>
          <div className="py-2">
            <NavItems
              activeTab={activeTab}
              onTabChange={onTabChange}
              collapsed={false}
              isAdmin={isAdmin}
              onItemClick={() => onMobileMenuOpenChange?.(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: sticky sidebar
  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "h-full flex flex-col border-r border-border/50 bg-sidebar transition-all duration-200 shrink-0",
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

        <NavItems activeTab={activeTab} onTabChange={onTabChange} collapsed={collapsed} isAdmin={isAdmin} />
      </aside>
    </TooltipProvider>
  );
};
