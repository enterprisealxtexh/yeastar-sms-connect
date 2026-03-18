import { useAgentConfig } from "@/hooks/useAgentConfig";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Brain, RefreshCw, Settings, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

const configLabels: Record<string, { label: string; description: string; unit?: string }> = {
  poll_interval: { 
    label: "SMS Poll Interval", 
    description: "How often to check for new SMS messages",
    unit: "ms"
  },
  heartbeat_interval: { 
    label: "Heartbeat Interval", 
    description: "How often the agent reports its status",
    unit: "ms"
  },
  cdr_poll_interval: { 
    label: "CDR Poll Interval", 
    description: "How often to check for new call records",
    unit: "ms"
  },
  retry_backoff_multiplier: { 
    label: "Retry Backoff", 
    description: "Multiplier for exponential backoff on failures"
  },
  max_retries: { 
    label: "Max Retries", 
    description: "Maximum retry attempts before giving up"
  },
  auto_restart_on_crash: { 
    label: "Auto-Restart", 
    description: "Automatically restart agent after crashes"
  },
};

export const AiConfigPanel = () => {
  const { data: configs, isLoading, updateConfig, triggerAiTuning } = useAgentConfig();
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown>>({});

  const handleSliderChange = (key: string, value: number[], config: typeof configs extends (infer T)[] ? T : never) => {
    const newValue = { ...config.config_value, value: value[0] };
    setPendingChanges(prev => ({ ...prev, [key]: newValue }));
  };

  const handleSwitchChange = (key: string, checked: boolean) => {
    const newValue = { enabled: checked };
    updateConfig.mutate({ key, value: newValue });
  };

  const handleSave = (key: string) => {
    if (pendingChanges[key]) {
      updateConfig.mutate({ key, value: pendingChanges[key] });
      setPendingChanges(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Agent Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
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
              <Settings className="h-5 w-5" />
              Agent Configuration
            </CardTitle>
            <CardDescription>
              AI-optimized settings for the local polling agent
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            onClick={() => triggerAiTuning.mutate()}
            disabled={triggerAiTuning.isPending}
          >
            {triggerAiTuning.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            AI Auto-Tune
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {configs?.map((config) => {
          const meta = configLabels[config.config_key] || { 
            label: config.config_key, 
            description: "" 
          };
          const isSlider = config.config_value.min !== undefined;
          const isSwitch = config.config_value.enabled !== undefined;
          const pendingValue = pendingChanges[config.config_key] as typeof config.config_value | undefined;
          const displayValue = pendingValue?.value ?? config.config_value.value;

          return (
            <div key={config.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{meta.label}</span>
                  {config.ai_tuned && (
                    <Badge variant="secondary" className="text-xs">
                      <Brain className="h-3 w-3 mr-1" />
                      AI Tuned
                    </Badge>
                  )}
                </div>
                {isSlider && (
                  <span className="text-sm text-muted-foreground">
                    {displayValue?.toLocaleString()}{meta.unit ? ` ${meta.unit}` : ''}
                  </span>
                )}
              </div>
              
              <p className="text-xs text-muted-foreground">{meta.description}</p>
              
              {isSlider && config.config_value.min !== undefined && config.config_value.max !== undefined && (
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <Slider
                      value={[displayValue ?? 0]}
                      min={config.config_value.min}
                      max={config.config_value.max}
                      step={config.config_value.min < 10 ? 0.1 : 1000}
                      onValueChange={(v) => handleSliderChange(config.config_key, v, config)}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>{config.config_value.min.toLocaleString()}</span>
                      <span>{config.config_value.max.toLocaleString()}</span>
                    </div>
                  </div>
                  {pendingChanges[config.config_key] && (
                    <Button 
                      size="sm" 
                      onClick={() => handleSave(config.config_key)}
                      disabled={updateConfig.isPending}
                    >
                      Save
                    </Button>
                  )}
                </div>
              )}
              
              {isSwitch && (
                <Switch
                  checked={config.config_value.enabled}
                  onCheckedChange={(checked) => handleSwitchChange(config.config_key, checked)}
                />
              )}

              {config.last_tuned_at && (
                <p className="text-xs text-muted-foreground">
                  Last tuned: {format(new Date(config.last_tuned_at), "MMM d, yyyy HH:mm")}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
