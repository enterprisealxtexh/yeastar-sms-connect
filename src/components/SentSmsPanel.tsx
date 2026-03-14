import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSentMessages } from "@/hooks/useSentMessages";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { usePortLabels, getPortLabel } from "@/hooks/usePortLabels";

export const SentSmsPanel: React.FC = () => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { data: messages = [], isLoading } = useSentMessages(1000);
  const { role, isAdmin } = useAuth();
  const canDelete = role === 'super_admin' || role === 'admin';
  const apiUrl = import.meta.env.VITE_API_URL;
  const token = localStorage.getItem('authToken');
  const { data: portLabels } = usePortLabels();

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
      if (prev.size === messages.length) return new Set<string>();
      return new Set(messages.map((m: any) => m.id));
    });
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => fetch(`${apiUrl}/api/sms-messages/${id}`, { 
        method: 'DELETE', 
        headers: { Authorization: `Bearer ${token}` } 
      })));
      toast.success('Deleted selected messages');
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['sent-messages'] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete');
    }
  };

  const deleteAll = async () => {
    if (!confirm(`Delete all ${messages.length} sent messages? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${apiUrl}/api/sms-messages/all-sent`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (res.ok) {
        toast.success(`Deleted ${result.deleted} sent messages`);
        setSelectedIds(new Set());
        queryClient.invalidateQueries({ queryKey: ['sent-messages'] });
      } else {
        toast.error(result.error || 'Failed to delete all');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete all');
    }
  };

  return (
    <div className="space-y-4">
      {/* Sent Messages Card */}
      <Card className="card-glow border-border/50 bg-card flex flex-col min-h-0">
        <CardHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold">Sent SMS Messages</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {messages.length} sent messages
              </p>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => queryClient.invalidateQueries({ queryKey: ["sent-messages"] })} 
              className="shrink-0"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        {/* Bulk toolbar */}
        {messages.length > 0 && (
          <div className="px-4 py-2 bg-card/40 border-b border-border/50 flex items-center gap-2 flex-wrap shrink-0">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input 
                type="checkbox" 
                checked={selectedIds.size === messages.length && messages.length > 0} 
                onChange={toggleSelectAll} 
                className="rounded" 
              />
              Select all
            </label>
            {canDelete && (
              <>
                <Button 
                  size="sm" 
                  variant="destructive" 
                  onClick={deleteSelected} 
                  disabled={selectedIds.size === 0}
                >
                  Delete ({selectedIds.size})
                </Button>
                <Button 
                  size="sm" 
                  variant="destructive"
                  onClick={deleteAll}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Delete All
                </Button>
              </>
            )}
          </div>
        )}

        <ScrollArea className="flex-1 min-h-0">
          <div className="divide-y divide-border/30">
            {messages.map((m: any) => (
              <div 
                key={m.id} 
                className="flex items-start p-4 gap-3 hover:bg-muted/30 transition"
              >
                {/* Checkbox */}
                <div className="flex items-center h-12" onClick={(e) => e.stopPropagation()}>
                  <input 
                    type="checkbox" 
                    checked={selectedIds.has(m.id)} 
                    onChange={() => toggleSelect(m.id)} 
                    className="rounded" 
                  />
                </div>

                {/* Avatar */}
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-600 font-medium flex-shrink-0 text-sm">
                  📤
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className="font-semibold truncate text-foreground">
                      {m.sender_number || 'System'}
                    </h3>
                    <div className="text-xs text-muted-foreground whitespace-nowrap flex flex-col items-end">
                      <span className="font-mono">{m.received_at}</span>
                      <span className="text-xs font-medium text-muted-foreground">—</span>
                    </div>
                  </div>

                  <p className="text-sm mt-2 line-clamp-2 text-muted-foreground">
                    {m.message_content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
};

export default SentSmsPanel;
