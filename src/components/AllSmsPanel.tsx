import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Trash2, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSmsMessages } from "@/hooks/useSmsMessages";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export const AllSmsPanel: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: messages = [], isLoading } = useSmsMessages(1000);
  const { role } = useAuth();
  const canDelete = role !== 'viewer';
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:2003";
  const token = localStorage.getItem('authToken');

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
    <Card className="card-glow border-border/50 bg-card h-full">
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle className="text-base font-semibold">All SMS Messages</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["sms-messages"] })}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[600px]">
          {isLoading ? (
            <div className="p-4">Loading...</div>
          ) : messages.length === 0 ? (
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
                  {messages.map((m: any) => (
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
  );
};

export default AllSmsPanel;
