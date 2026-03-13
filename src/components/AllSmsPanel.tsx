import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trash2, RefreshCw, Eye, EyeOff, Lock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSmsMessages } from "@/hooks/useSmsMessages";
import { useAuth } from "@/hooks/useAuth";
import { useUserPermissions } from "@/hooks/useUserPermissions";
import { SmsFilters, SmsFiltersState } from "./SmsFilters";
import { SentSmsPanel } from "./SentSmsPanel";
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
  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { data: messages = [], isLoading } = useSmsMessages(1000);
  const { role, isAdmin } = useAuth();
  const { data: permissions } = useUserPermissions();
  const canDelete = role === 'super_admin';
  const apiUrl = import.meta.env.VITE_API_URL;
  const token = localStorage.getItem('authToken');
  const { data: portLabels } = usePortLabels();

  // Function to truncate message content for non-admin users
  const getTruncatedContent = (content: string): string => {
    if (isAdmin) return content;
    const sensitiveMarker = "New Utility balance";
    const index = content.indexOf(sensitiveMarker);
    if (index !== -1) {
      return content.substring(0, index).trim();
    }
    return content;
  };

  // Get unique SIM ports from messages (Port number 1-4)
  const simPorts = useMemo(() => {
    const ports = new Set(messages.map((m: any) => m.simPort || m.gsmSpan - 1));
    return Array.from(ports).sort((a: number, b: number) => a - b);
  }, [messages]);

  // Filter messages based on current filters AND user permissions
  const filteredMessages = useMemo(() => {
    return messages.filter((message: any) => {
      // Port permission check - if user has port restrictions, filter by them
      if (permissions?.ports && permissions.ports.length > 0) {
        if (!permissions.ports.includes(message.simPort)) return false;
      }

      // Extension permission check - if user has extension restrictions, filter by them
      if (permissions?.extensions && permissions.extensions.length > 0) {
        // Note: SMS messages may not have extensions directly; extensions are for calls
        // For now, we skip extension filtering for SMS
      }

      // Read/Unread filter
      if (readFilter === 'unread' && !message.isNew) return false;
      if (readFilter === 'read' && message.isNew) return false;

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
  }, [messages, filters, readFilter, permissions]);

  const handleMarkRead = async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/sms-messages/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
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

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (prev.size === filteredMessages.length) return new Set<string>();
      return new Set(filteredMessages.map((m: any) => m.id));
    });
  };

  const markSelectedAsRead = async () => {
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => fetch(`${apiUrl}/api/sms-messages/${id}/status`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ status: 'read' })
      })));
      toast.success('Marked selected as read');
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['sms-messages'] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to mark selected');
    }
  };

  const markAllAsRead = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/sms-messages/mark-all-read`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await res.json();
      if (res.ok) {
        toast.success(`Marked ${result.changed || 0} messages as read`);
        setSelectedIds(new Set());
        queryClient.invalidateQueries({ queryKey: ['sms-messages'] });
      } else {
        toast.error(result.error || 'Failed to mark all as read');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to mark all as read');
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => fetch(`${apiUrl}/api/sms-messages/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })));
      toast.success('Deleted selected messages');
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['sms-messages'] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete');
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

      {/* Messages Tabs */}
      <Tabs defaultValue="received" className="w-full">
        <div className="mb-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="received">Received SMS</TabsTrigger>
            <TabsTrigger value="sent">Sent SMS</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="received" className="space-y-0">
          {/* Received Messages Card */}
          <Card className="card-glow border-border/50 bg-card flex flex-col min-h-0">
            <CardHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold">All SMS Messages</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {filteredMessages.length}
                {filteredMessages.length !== messages.length && ` / ${messages.length}`} messages
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["sms-messages"] })} className="shrink-0">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          {/* Read/Unread Filter Tabs */}
          <div className="flex gap-1 bg-muted/20 p-1 rounded-lg w-fit">
            <button onClick={() => setReadFilter('all')} className={`px-3 py-1 text-sm rounded-md ${readFilter==='all'?'bg-card text-primary shadow':'text-muted-foreground'}`}>All</button>
            <button onClick={() => setReadFilter('unread')} className={`px-3 py-1 text-sm rounded-md ${readFilter==='unread'?'bg-card text-primary shadow':'text-muted-foreground'}`}>Unread <span className="ml-1 text-xs">{messages.filter((m: any)=>m.isNew).length}</span></button>
            <button onClick={() => setReadFilter('read')} className={`px-3 py-1 text-sm rounded-md ${readFilter==='read'?'bg-card text-primary shadow':'text-muted-foreground'}`}>Read</button>
          </div>
        </CardHeader>

        {/* Bulk toolbar */}
        {filteredMessages.length > 0 && (
          <div className="px-4 py-2 bg-card/40 border-b border-border/50 flex items-center gap-2 flex-wrap shrink-0">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={selectedIds.size === filteredMessages.length && filteredMessages.length>0} onChange={toggleSelectAll} className="rounded" />
              Select all
            </label>
            {canDelete && (
              <Button size="sm" variant="destructive" onClick={deleteSelected} disabled={selectedIds.size===0}>Delete ({selectedIds.size})</Button>
            )}
            <Button size="sm" variant="outline" onClick={markAllAsRead}>Mark all as read</Button>
          </div>
        )}

      <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-4">Loading...</div>
          ) : filteredMessages.length === 0 ? (
            <div className="p-4 text-muted-foreground">No messages found</div>
          ) : (
            <div className="divide-y divide-border/50">
              {filteredMessages.map((m: any) => (
                <div key={m.id} className={`flex items-start p-4 gap-3 hover:bg-muted/30 transition ${m.isNew ? 'bg-primary/5' : ''}`}>
                  {/* Checkbox */}
                  <div className="flex items-center h-12" onClick={(e)=>e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggleSelect(m.id)} className="rounded" />
                  </div>

                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium flex-shrink-0 text-sm">
                    {(m.sender||'').split(' ').map((s: string)=>s[0]).slice(0,2).join('')}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className={`font-semibold truncate ${m.isNew ? 'text-foreground' : 'text-muted-foreground'}`}>{m.sender}</h3>
                      <div className="text-xs text-muted-foreground whitespace-nowrap flex flex-col items-end">
                        <span className="font-mono">{m.timestamp}</span>
                        <span className="text-xs font-medium">{m.portName || getPortLabel(m.simPort, portLabels)}</span>
                      </div>
                    </div>

                    {m.isNew && <span className="inline-block w-2 h-2 bg-primary rounded-full" />}

                    <p className={`text-sm mt-2 line-clamp-2 ${m.isNew ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{getTruncatedContent(m.content)}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => handleMarkRead(m.id)} className="p-1 h-auto">{m.isNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
        </TabsContent>

        <TabsContent value="sent" className="space-y-0">
          <SentSmsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AllSmsPanel;
