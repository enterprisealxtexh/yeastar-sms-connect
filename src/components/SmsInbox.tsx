import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Clock, Sparkles, Loader2 } from "lucide-react";
import { SmsFilters, SmsFiltersState } from "./SmsFilters";
import { ManualSmsImport } from "./ManualSmsImport";
import { SmsCategoryBadge, SmsCategory } from "./SmsCategoryBadge";
import { useCategorizeMessages } from "@/hooks/useSmsMessages";

interface SmsMessage {
  id: string;
  sender: string;
  simPort: number;
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

const initialFilters: SmsFiltersState = {
  search: "",
  simPort: "all",
  status: "all",
  category: "all",
  dateFrom: undefined,
  dateTo: undefined,
};

export const SmsInbox = ({ messages }: SmsInboxProps) => {
  const [filters, setFilters] = useState<SmsFiltersState>(initialFilters);
  const categorize = useCategorizeMessages();

  // Get unique SIM ports from messages
  const simPorts = useMemo(() => {
    const ports = new Set(messages.map((m) => m.simPort));
    return Array.from(ports).sort((a, b) => a - b);
  }, [messages]);

  // Count uncategorized messages
  const uncategorizedCount = useMemo(() => {
    return messages.filter((m) => m.category === "unknown").length;
  }, [messages]);

  // Filter messages based on current filters
  const filteredMessages = useMemo(() => {
    return messages.filter((message) => {
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
        const messageDate = message.receivedAt;
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

  const handleCategorizeAll = () => {
    categorize.mutate({ batch: true });
  };

  return (
    <Card className="card-glow border-border/50 bg-card h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <MessageSquare className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-base font-semibold">SMS Inbox</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {uncategorizedCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCategorizeAll}
                disabled={categorize.isPending}
                className="gap-1.5 text-xs"
              >
                {categorize.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                Categorize ({uncategorizedCount})
              </Button>
            )}
            <ManualSmsImport />
            <Badge variant="secondary" className="font-mono">
              {filteredMessages.length}
              {filteredMessages.length !== messages.length && ` / ${messages.length}`} messages
            </Badge>
          </div>
        </div>
        <SmsFilters
          filters={filters}
          onFiltersChange={setFilters}
          simPorts={simPorts}
        />
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[350px]">
          {filteredMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
              <MessageSquare className="w-10 h-10 mb-2 opacity-50" />
              <p className="text-sm">No messages found</p>
              {filters.search && (
                <p className="text-xs mt-1">Try adjusting your search filters</p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {filteredMessages.map((message) => (
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
                        SIM {message.simPort}
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
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                      <Clock className="w-3 h-3" />
                      <span className="font-mono">{message.timestamp}</span>
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
