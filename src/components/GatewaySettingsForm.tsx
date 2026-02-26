import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Eye, EyeOff, Server, Wifi, WifiOff, CheckCircle2 } from "lucide-react";
import { useGatewayConfig } from "@/hooks/useGatewayConfig";
import { toast } from "@/hooks/use-toast";

export const GatewaySettingsForm = () => {
  const { config, isLoading, updateConfig } = useGatewayConfig();
  const [showPassword, setShowPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [localConfig, setLocalConfig] = useState({
    gateway_ip: "",
    api_username: "",
    api_password: "",
  });

  useEffect(() => {
    if (config) {
      setLocalConfig({
        gateway_ip: config.gateway_ip || "",
        api_username: config.api_username || "",
        api_password: config.api_password || "",
      });
    }
  }, [config]);

  const handleSave = async () => {
    try {
      console.log('[GatewaySettingsForm] Starting save...');
      console.log('[GatewaySettingsForm] localConfig:', localConfig);
      
      console.log('[GatewaySettingsForm] Calling updateConfig.mutateAsync()...');
      const result = await updateConfig.mutateAsync(localConfig);
      console.log('[GatewaySettingsForm] ✓ mutateAsync completed, result:', result);

      // Log to local API instead of Supabase
      const apiUrl = import.meta.env.VITE_API_URL;
      await fetch(`${apiUrl}/api/activity-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: "config_update",
          message: "Gateway configuration updated",
          severity: "info",
        })
      }).catch(() => {});

      toast({
        title: "Gateway settings saved",
        description: "TG400 gateway configuration has been updated.",
      });
      
      setConnectionStatus('idle');
    } catch (error) {
      console.error('[GatewaySettingsForm] Save error:', error);
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Failed to save gateway settings",
        variant: "destructive",
      });
    }
  };

  const handleTestConnection = async () => {
    // First save the current config
    if (localConfig.gateway_ip !== config?.gateway_ip || 
        localConfig.api_username !== config?.api_username || 
        localConfig.api_password !== config?.api_password) {
      await handleSave();
    }

    setIsTesting(true);
    setConnectionStatus('idle');

    try {
      // Test real connection to TG400 Gateway via backend endpoint
      const gateway_ip = localConfig.gateway_ip || '192.168.5.3';
      const api_port = localConfig.api_port || 5038;
      
      const response = await fetch(`${apiUrl}/api/gateway-test`);
      const result = await response.json();
      
      if (response.ok && result.success) {
        setConnectionStatus('success');
        toast({
          title: "Connection successful",
          description: `✅ Connected to TG400 at ${gateway_ip}:${api_port} - Authentication successful`,
        });
      } else {
        throw new Error(result.error || `Failed to connect to TG400 (${result.status || 'Unknown error'})`);
      }
    } catch (error) {
      setConnectionStatus('error');
      console.error('Test connection error:', error);
      toast({
        title: "Test failed",
        description: error instanceof Error ? error.message : "Failed to test connection to TG400 Gateway.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <Server className="w-4 h-4 text-muted-foreground" />
        <Label className="text-muted-foreground font-medium">TG400 Gateway Settings</Label>
      </div>
      
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="gateway-ip" className="text-xs text-muted-foreground">
            Gateway IP Address
          </Label>
          <Input
            id="gateway-ip"
            value={localConfig.gateway_ip}
            onChange={(e) => {
              setLocalConfig((prev) => ({ ...prev, gateway_ip: e.target.value }));
              setConnectionStatus('idle');
            }}
            className="font-mono text-sm h-9 bg-muted/50 border-border/50"
            placeholder="192.168.1.100"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="api-username" className="text-xs text-muted-foreground">
            API Username
          </Label>
          <Input
            id="api-username"
            autoComplete="off"
            value={localConfig.api_username}
            onChange={(e) => {
              setLocalConfig((prev) => ({ ...prev, api_username: e.target.value }));
              setConnectionStatus('idle');
            }}
            className="text-sm h-9 bg-muted/50 border-border/50"
            placeholder="admin"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="api-password" className="text-xs text-muted-foreground">
            API Password
          </Label>
          <div className="relative">
            <Input
              id="api-password"
              autoComplete="off"
              type={showPassword ? "text" : "password"}
              value={localConfig.api_password}
              onChange={(e) => {
                setLocalConfig((prev) => ({ ...prev, api_password: e.target.value }));
                setConnectionStatus('idle');
              }}
              className="text-sm h-9 bg-muted/50 border-border/50 pr-9"
              placeholder="••••••••"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-9 w-9 px-2 hover:bg-transparent"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Eye className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleTestConnection}
          disabled={isTesting || !localConfig.gateway_ip}
          className="gap-2"
        >
          {isTesting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : connectionStatus === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : connectionStatus === 'error' ? (
            <WifiOff className="w-4 h-4 text-destructive" />
          ) : (
            <Wifi className="w-4 h-4" />
          )}
          {isTesting ? "Testing..." : "Test Connection"}
        </Button>

        <Button
          size="sm"
          onClick={handleSave}
          disabled={updateConfig.isPending}
          className="gap-2"
        >
          {updateConfig.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {updateConfig.isPending ? "Saving..." : "Save Gateway Settings"}
        </Button>
      </div>
    </div>
  );
};
