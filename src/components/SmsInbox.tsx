import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Clock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SmsCategoryBadge, SmsCategory } from "./SmsCategoryBadge";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePortLabels, getPortLabel } from "@/hooks/usePortLabels";

interface SmsMessage {
  id: string;
  sender: string;
  simPort: number;
  gsmSpan?: number;
  portName?: string;
  content: string;
  timestamp: string;
  receivedAt: Date;
  isNew: boolean;
  category: SmsCategory;
  categoryConfidence?: number;
  status?: string;
}

interface SmsInboxProps {
  messages: SmsMessage[];
}

export const SmsInbox = ({ messages }: SmsInboxProps) => {
  const queryClient = useQueryClient();
  const apiUrl = import.meta.env.VITE_API_URL;
  const token = localStorage.getItem('authToken');
  const { data: portLabels } = usePortLabels();

  // Count messages received today
  const todaySmsCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return messages.filter((m) => m.receivedAt >= today).length;
  }, [messages]);

  // Get the last 5 recent messages without filtering
  const recentMessages = useMemo(() => {
    return messages.slice(0, 5);
  }, [messages]);

  const handleMarkRead = async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/sms-messages/${id}/status`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ status: "read" }),
      });
      const result = await res.json();
      if (res.ok) {
        toast.success("Marked as read");
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
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <MessageSquare className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">SMS Inbox</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">{todaySmsCount} received today</p>
            </div>
          </div>
          <Badge variant="secondary" className="font-mono">
            {recentMessages.length} recent
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[350px]">
          {recentMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
              <MessageSquare className="w-10 h-10 mb-2 opacity-50" />
              <p className="text-sm">No messages found</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {recentMessages.map((message) => (
                <div
                  key={message.id}
                  className={`p-4 hover:bg-muted/30 transition-colors ${
                    message.isNew ? "border-l-2 border-l-primary" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium text-foreground">
                        {message.sender}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs font-mono border-primary/30 text-primary"
                      >
                        {message.portName || getPortLabel(message.simPort, portLabels)}
                      </Badge>
                      <SmsCategoryBadge 
                        category={message.category} 
                        confidence={message.categoryConfidence}
                        showConfidence={message.categoryConfidence !== undefined}
                      />
                      {message.isNew && (
                        <Badge className="text-xs bg-primary/20 text-primary border-0">
                          New
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleMarkRead(message.id)}
                        className="p-1 h-auto"
                        title={message.isNew ? "Mark as read" : "Already read"}
                      >
                        {message.isNew ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </Button>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span className="font-mono">{message.timestamp}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-secondary-foreground leading-relaxed">
                    {message.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
