import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { 
  Brain, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingUp, 
  Settings2,
  Zap,
  Shield
} from "lucide-react";

interface PredictionResult {
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  prediction: string;
  recommended_action: string;
  auto_applied: boolean;
}

interface OptimizationResult {
  prediction: PredictionResult;
  tuning: {
    recommendations: Array<{
      config: string;
      old_value: number;
      new_value: number;
      reason: string;
    }>;
    error_count: number;
  };
  learning: {
    feedback_count: number;
    patterns_found: number;
    insights: string[];
    ai_rules: string[];
  };
}

export function PredictiveMaintenancePanel() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [lastResult, setLastResult] = useState<OptimizationResult | null>(null);

  const runFullOptimization = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-diagnostics', {
        body: { action: 'auto_optimize' }
      });

      if (error) throw error;

      setLastResult(data.results);
      toast({
        title: "AI Optimization Complete",
        description: `Risk level: ${data.results.prediction.risk_level.toUpperCase()}`,
      });
    } catch (error) {
      toast({
        title: "Optimization Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const runPredictiveCheck = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-diagnostics', {
        body: { action: 'predict_issues' }
      });

      if (error) throw error;

      setLastResult(prev => prev ? { ...prev, prediction: data.prediction } : null);
      toast({
        title: "Predictive Analysis Complete",
        description: data.prediction.prediction,
        variant: data.prediction.risk_level === 'critical' ? 'destructive' : 'default',
      });
    } catch (error) {
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      default: return 'bg-green-500';
    }
  };

  const getRiskIcon = (level: string) => {
    switch (level) {
      case 'critical':
      case 'high':
        return <AlertTriangle className="h-5 w-5" />;
      default:
        return <CheckCircle2 className="h-5 w-5" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            AI Predictive Maintenance
          </h3>
          <p className="text-sm text-muted-foreground">
            AI-powered system health monitoring and auto-optimization
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={runPredictiveCheck} disabled={isLoading}>
            <Shield className="h-4 w-4 mr-2" />
            Check Health
          </Button>
          <Button onClick={runFullOptimization} disabled={isLoading}>
            {isLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
            Full Optimization
          </Button>
        </div>
      </div>

      {/* Results Display */}
      {lastResult && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Prediction Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {getRiskIcon(lastResult.prediction.risk_level)}
                System Health Prediction
              </CardTitle>
              <CardDescription>Current risk assessment</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className={getRiskColor(lastResult.prediction.risk_level)}>
                  {lastResult.prediction.risk_level.toUpperCase()}
                </Badge>
                {lastResult.prediction.auto_applied && (
                  <Badge variant="outline" className="text-green-600">
                    Auto-fix Applied
                  </Badge>
                )}
              </div>
              <p className="text-sm">{lastResult.prediction.prediction}</p>
              <p className="text-sm text-muted-foreground">
                <strong>Recommended:</strong> {lastResult.prediction.recommended_action}
              </p>
            </CardContent>
          </Card>

          {/* Config Tuning Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Smart Config Optimization
              </CardTitle>
              <CardDescription>
                {lastResult.tuning.error_count} errors in last 24h
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {lastResult.tuning.recommendations.length > 0 ? (
                lastResult.tuning.recommendations.map((rec, i) => (
                  <div key={i} className="text-sm p-2 bg-muted rounded">
                    <div className="font-medium">{rec.config}</div>
                    <div className="text-muted-foreground">
                      {rec.old_value}ms → {rec.new_value}ms
                    </div>
                    <div className="text-xs mt-1">{rec.reason}</div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No config changes needed - system is optimized
                </p>
              )}
            </CardContent>
          </Card>

          {/* SMS Learning Card */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                SMS Classification Learning
              </CardTitle>
              <CardDescription>
                Analyzed {lastResult.learning.feedback_count} user corrections
              </CardDescription>
            </CardHeader>
            <CardContent>
              {lastResult.learning.patterns_found > 0 ? (
                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Patterns Detected:</h4>
                    <div className="flex flex-wrap gap-2">
                      {lastResult.learning.insights.map((insight, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {insight}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {lastResult.learning.ai_rules.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">AI-Generated Rules:</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {lastResult.learning.ai_rules.map((rule, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-primary">•</span>
                            {rule}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No learning patterns yet. Correct SMS categories to help the AI learn.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty State */}
      {!lastResult && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">AI Ready</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Run a full optimization to analyze system health, tune configurations, and improve SMS classification.
            </p>
            <Button onClick={runFullOptimization} disabled={isLoading}>
              <Zap className="h-4 w-4 mr-2" />
              Run Full Optimization
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
