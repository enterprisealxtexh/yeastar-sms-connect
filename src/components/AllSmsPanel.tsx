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
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:2003";
  const token = localStorage.getItem('authToken');

  // Get unique SIM ports from messages
  const simPorts = useMemo(() => {
    const ports = new Set(messages.map((m: any) => m.simPort));
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
          />
        </CardHeader>
      </Card>

      {/* Messages Card */}
      <Card className="card-glow border-border/50 bg-card h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">All SMS Messages</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {filteredMessages.length}
                {filteredMessages.length !== messages.length && ` / ${messages.length}`} messages
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["sms-messages"] })}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[600px]">
          {isLoading ? (
            <div className="p-4">Loading...</div>
          ) : filteredMessages.length === 0 ? (
            <div className="p-4 text-muted-foreground">No messages found</div>
          ) : (
            <div className="overflow-x-auto w-full">
              <table className="w-full min-w-[800px] table-auto">
                <thead>
                  <tr className="text-left text-sm text-muted-foreground">
                    <th className="p-3">Received</th>
                    <th className="p-3">Sender</th>
                    <th className="p-3">SIM</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Message</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMessages.map((m: any) => (
                    <tr key={m.id} className="border-t border-border/50">
                      <td className="p-3 font-mono text-sm">{m.timestamp}</td>
                      <td className="p-3 font-mono text-sm">{m.sender}</td>
                      <td className="p-3">{m.simPort}</td>
                      <td className="p-3 font-mono text-sm">{m.isNew ? 'unread' : (m.status || 'read')}</td>
                      <td className="p-3 text-sm">{m.content}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleMarkRead(m.id)}>Mark Read</Button>
                          {canDelete ? (
                            <Button size="sm" variant="destructive" onClick={() => handleDelete(m.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" disabled title="Viewers cannot delete messages">
                              <Trash2 className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
    </div>
  );
};

export default AllSmsPanel;
