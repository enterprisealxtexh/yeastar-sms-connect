import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Trash2, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSmsMessages } from "@/hooks/useSmsMessages";
import { useAuth } from "@/hooks/useAuth";
import { SmsFilters, SmsFiltersState } from "./SmsFilters";
import { toast } from "sonner";
import { usePortLabels, getPortLabel } from "@/hooks/usePortLabels";

const initialFilters: SmsFiltersState = {
  search: "",
  simPort: "all",
  status: "all",
  category: "all",
  dateFrom: undefined,
  dateTo: undefined,
};

export const AllSmsPanel: React.FC = () => {
  const [filters, setFilters] = useState<SmsFiltersState>(initialFilters);
  const queryClient = useQueryClient();
  const { data: messages = [], isLoading } = useSmsMessages(1000);
  const { role } = useAuth();
  const canDelete = role !== 'viewer';
  const apiUrl = import.meta.env.VITE_API_URL;
  const token = localStorage.getItem('authToken');
  const { data: portLabels } = usePortLabels();

  // Get unique SIM ports from messages (Port number 1-4)
  const simPorts = useMemo(() => {
    const ports = new Set(messages.map((m: any) => m.simPort || m.gsmSpan - 1));
    return Array.from(ports).sort((a: number, b: number) => a - b);
  }, [messages]);

  // Filter messages based on current filters
  const filteredMessages = useMemo(() => {
    return messages.filter((message: any) => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesSender = message.sender.toLowerCase().includes(searchLower);
        const matchesContent = message.content.toLowerCase().includes(searchLower);
        if (!matchesSender && !matchesContent) return false;
      }

      // SIM Port filter
      if (filters.simPort !== "all" && message.simPort !== parseInt(filters.simPort)) {
        return false;
      }

      // Status filter
      if (filters.status !== "all") {
        const messageStatus = message.isNew ? "unread" : (message.status || "read");
        if (messageStatus !== filters.status) return false;
      }

      // Category filter
      if (filters.category !== "all" && message.category !== filters.category) {
        return false;
      }

      // Date filters
      if (filters.dateFrom || filters.dateTo) {
        const messageDate = new Date(message.timestamp);
        if (filters.dateFrom && messageDate < filters.dateFrom) return false;
        if (filters.dateTo) {
          const endOfDay = new Date(filters.dateTo);
          endOfDay.setHours(23, 59, 59, 999);
          if (messageDate > endOfDay) return false;
        }
      }

      return true;
    });
  }, [messages, filters]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this message? This action cannot be undone.")) return;
    try {
      const res = await fetch(`${apiUrl}/api/sms-messages/${id}`, { 
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      const result = await res.json();
      if (res.ok) {
        toast.success(result.message || "Deleted");
        queryClient.invalidateQueries({ queryKey: ["sms-messages"] });
      } else {
        toast.error(result.error || "Failed to delete");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete");
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/sms-messages/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "read" }),
      });
      const result = await res.json();
      if (res.ok) {
        toast.success("Marked read");
        queryClient.invalidateQueries({ queryKey: ["sms-messages"] });
      } else {
        toast.error(result.error || "Failed to update");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters Card */}
      <Card className="border-border/50 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold mb-4">Filters</CardTitle>
          <SmsFilters
            filters={filters}
            onFiltersChange={setFilters}
            simPorts={simPorts}
            portLabels={portLabels}
          />
        </CardHeader>
      </Card>

      {/* Messages Card */}
      <Card className="card-glow border-border/50 bg-card flex flex-col min-h-0">
        <CardHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold">All SMS Messages</CardTitle>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {filteredMessages.length}
                {filteredMessages.length !== messages.length && ` / ${messages.length}`} messages
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["sms-messages"] })} className="shrink-0">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-4">Loading...</div>
          ) : filteredMessages.length === 0 ? (
            <div className="p-4 text-muted-foreground">No messages found</div>
          ) : (
            <div className="space-y-2 p-4">
              {filteredMessages.map((m: any) => (
                <div
                  key={m.id}
                  className="p-4 border border-border/50 rounded-lg hover:bg-muted/30 transition-colors"
                >
                  {/* Header Row: Time, Sender, Status */}
                  <div className="flex items-start justify-between mb-3 gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">{m.timestamp}</span>
                        <span className="font-mono text-sm font-medium">{m.sender}</span>
                        <span className={`text-xs px-2 py-1 rounded font-medium ${
                          m.isNew ? "bg-blue-500/20 text-blue-700 dark:text-blue-300" 
                          : "bg-muted text-muted-foreground"
                        }`}>
                          {m.isNew ? 'unread' : (m.status || 'read')}
                        </span>
                        <span className="text-xs px-2 py-1 rounded border border-primary/30 text-primary">
                          {m.portName || getPortLabel(m.simPort, portLabels)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => handleMarkRead(m.id)} title="Mark as read">
                        Mark Read
                      </Button>
                      {canDelete ? (
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(m.id)} title="Delete message">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" disabled title="Viewers cannot delete messages">
                          <Trash2 className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Message Content */}
                  <div className="text-sm text-secondary-foreground leading-relaxed break-words">
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
    </div>
  );
};

export default AllSmsPanel;
