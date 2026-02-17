import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Phone, Clock, CheckCircle2, XCircle, Loader2, X } from "lucide-react";
import { useCallQueue, type CallQueueItem } from "@/hooks/useCallQueue";
import { formatDistanceToNow } from "date-fns";
import { formatDateNairobi } from "@/lib/dateUtils";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ElementType }> = {
  pending: { label: "Pending", variant: "outline", icon: Clock },
  in_progress: { label: "Calling", variant: "secondary", icon: Loader2 },
  completed: { label: "Completed", variant: "default", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "destructive", icon: XCircle },
  cancelled: { label: "Cancelled", variant: "outline", icon: X },
};

const CallQueueItem = ({ item }: { item: CallQueueItem }) => {
  const config = statusConfig[item.status] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <span className="font-medium">{item.to_number}</span>
          <span className="text-xs text-muted-foreground">
            From: {item.from_extension} • {formatDateNairobi(item.requested_at)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={config.variant} className="gap-1">
          <Icon className={`h-3 w-3 ${item.status === "in_progress" ? "animate-spin" : ""}`} />
          {config.label}
        </Badge>
        {item.status === "pending" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => cancelCall(item.id)}
            disabled={isCancelling}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

export const CallQueueStatus = () => {
  const { data: queue, isLoading } = useCallQueue();
  
  const pendingCalls = queue?.filter(c => c.status === "pending" || c.status === "in_progress") || [];
  const recentCalls = queue?.filter(c => c.status === "completed" || c.status === "failed").slice(0, 5) || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Call Queue
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Phone className="h-5 w-5" />
          Call Queue
          {pendingCalls.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {pendingCalls.length} pending
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pendingCalls.length === 0 && recentCalls.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No calls in queue. Use Quick Dial or click a call-back button to initiate calls.
          </p>
        ) : (
          <div className="space-y-1">
            {pendingCalls.map((item) => (
              <CallQueueItem key={item.id} item={item} />
            ))}
            {recentCalls.length > 0 && pendingCalls.length > 0 && (
              <div className="text-xs text-muted-foreground pt-2 pb-1">Recent</div>
            )}
            {recentCalls.map((item) => (
              <CallQueueItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
