import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Phone, AlertCircle } from "lucide-react";
import { useCallLogs } from "@/hooks/useCallLogs";

export const CallLogsPanel = () => {
  const { logs, isLoading, error } = useCallLogs();

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Call Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Call Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const { inbound, outbound, total } = logs || {
    inbound: { count: 0, calls: [] },
    outbound: { count: 0, calls: [] },
    total: 0,
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Call Logs
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            Total: {total} calls
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Inbound Calls */}
        <div>
          <h3 className="text-sm font-semibold mb-3">
            📥 Inbound Calls ({inbound.count})
          </h3>
          {inbound.calls.length === 0 ? (
            <p className="text-sm text-muted-foreground">No inbound calls</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Caller</TableHead>
                    <TableHead>Callee</TableHead>
                    <TableHead>Trunk</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inbound.calls.map((call, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono">{call.caller}</TableCell>
                      <TableCell className="font-mono">{call.callee}</TableCell>
                      <TableCell>{call.trunk}</TableCell>
                      <TableCell>{call.duration || "0"}s</TableCell>
                      <TableCell>{call.starttime}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Outbound Calls */}
        <div>
          <h3 className="text-sm font-semibold mb-3">
            📤 Outbound Calls ({outbound.count})
          </h3>
          {outbound.calls.length === 0 ? (
            <p className="text-sm text-muted-foreground">No outbound calls</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Caller</TableHead>
                    <TableHead>Callee</TableHead>
                    <TableHead>Trunk</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outbound.calls.map((call, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono">{call.caller}</TableCell>
                      <TableCell className="font-mono">{call.callee}</TableCell>
                      <TableCell>{call.trunk}</TableCell>
                      <TableCell>{call.duration || "0"}s</TableCell>
                      <TableCell>{call.starttime}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
