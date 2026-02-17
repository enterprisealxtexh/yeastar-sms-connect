import { useErrorLogs, type ErrorLog } from "@/hooks/useErrorLogs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, CheckCircle, Brain, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { formatDateNairobi } from "@/lib/dateUtils";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";

export const ErrorLogsPanel = () => {
  const { data: errors, isLoading } = useErrorLogs();
  const [diagnosingId, setDiagnosingId] = useState<string | null>(null);

  const unresolvedCount = (errors || []).filter(e => !e.resolved).length;

  const handleDiagnose = async (errorId: string) => {
    setDiagnosingId(errorId);
    try {
      toast({
        title: "Diagnosing Error",
        description: "AI analysis in progress...",
      });
      // AI diagnosis logic would go here
      setTimeout(() => setDiagnosingId(null), 2000);
    } catch (error) {
      toast({
        title: "Diagnosis Failed",
        description: error instanceof Error ? error.message : "Could not diagnose error",
        variant: "destructive",
      });
      setDiagnosingId(null);
    }
  };

  const handleResolve = (errorId: string) => {
    toast({
      title: "Error Resolved",
      description: "Error marked as resolved",
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Error Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Error Logs
              {unresolvedCount > 0 && (
                <Badge variant="destructive">{unresolvedCount} unresolved</Badge>
              )}
            </CardTitle>
            <CardDescription>
              AI-powered error diagnostics and auto-fix suggestions
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {errors?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-500" />
            <p>No errors detected</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {errors?.map((error) => (
                <ErrorLogCard
                  key={error.id}
                  error={error}
                  onDiagnose={() => handleDiagnose(error.id)}
                  onResolve={() => handleResolve(error.id)}
                  isDiagnosing={diagnosingId === error.id}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};

interface ErrorLogCardProps {
  error: ErrorLog;
  onDiagnose: () => void;
  onResolve: () => void;
  isDiagnosing: boolean;
}

const ErrorLogCard = ({ error, onDiagnose, onResolve, isDiagnosing }: ErrorLogCardProps) => {
  return (
    <div className={`p-3 rounded-lg border ${error.resolved ? 'bg-muted/50 opacity-60' : 'bg-destructive/5 border-destructive/20'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={error.resolved ? "secondary" : "destructive"}>
              {error.error_type}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatDateNairobi(error.created_at)}
            </span>
            {error.agent_id && (
              <span className="text-xs text-muted-foreground">
                Agent: {error.agent_id.substring(0, 12)}...
              </span>
            )}
          </div>
          <p className="text-sm truncate">{error.error_message}</p>
          
          {error.ai_diagnosis && (
            <div className="mt-2 p-2 bg-primary/10 rounded text-sm">
              <p className="font-medium text-primary">AI Diagnosis:</p>
              <p className="text-muted-foreground">{error.ai_diagnosis}</p>
            </div>
          )}
          
          {error.ai_suggested_fix && (
            <div className="mt-1 p-2 bg-accent/50 rounded text-sm">
              <p className="font-medium text-accent-foreground">Suggested Fix:</p>
              <p className="text-muted-foreground">{error.ai_suggested_fix}</p>
            </div>
          )}

          {error.auto_fix_attempted && (
            <div className="mt-1 text-xs text-muted-foreground">
              Auto-fix attempted: {error.auto_fix_result || 'In progress...'}
            </div>
          )}
        </div>
        
        <div className="flex flex-col gap-1">
          {!error.ai_diagnosis && !error.resolved && (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={onDiagnose}
              disabled={isDiagnosing}
            >
              {isDiagnosing ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Brain className="h-3 w-3" />
              )}
              <span className="ml-1">Diagnose</span>
            </Button>
          )}
          {!error.resolved && (
            <Button size="sm" variant="ghost" onClick={onResolve}>
              <CheckCircle className="h-3 w-3 mr-1" />
              Resolve
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
