import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Eye, EyeOff, Phone, Wifi, WifiOff, CheckCircle2, Trash2 } from "lucide-react";
import { usePbxConfig } from "@/hooks/usePbxConfig";
import { useToast } from "@/hooks/use-toast";

const apiUrl = import.meta.env.VITE_API_URL;

export const PbxSettingsForm = () => {
  const { config, isLoading, updateConfig } = usePbxConfig();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [localConfig, setLocalConfig] = useState({
    pbx_ip: "",
    pbx_port: 5060,
    api_username: "",
    api_password: "",
    web_port: 8333,
  });

  useEffect(() => {
    if (config) {
      setLocalConfig({
        pbx_ip: config.pbx_ip || "",
        pbx_port: config.pbx_port || 5060,
        api_username: config.api_username || "",
        api_password: config.api_password || "",
        web_port: config.web_port || 8333,
      });
    }
  }, [config]);

  const handleSave = async () => {
    try {
      await updateConfig.mutateAsync(localConfig);
      
      // Log activity via local API
      await fetch(`${apiUrl}/api/activity-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: "config_update",
          message: "S100 PBX configuration updated",
          severity: "success",
          metadata: JSON.stringify({ updated_fields: ["pbx_ip", "pbx_port", "api_username", "api_password", "web_port"] }),
        }),
      });
      
      setConnectionStatus('idle');
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Failed to save PBX settings",
        variant: "destructive",
      });
    }
  };

  const handleClearCalls = async () => {
    if (!confirm('Are you sure you want to delete all call records? This action cannot be undone.')) {
      return;
    }

    setIsClearing(true);
    try {
      const response = await fetch(`${apiUrl}/api/clear-calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Success",
          description: `✅ Deleted ${result.deleted} call records`,
        });

        // Log activity
        await fetch(`${apiUrl}/api/activity-logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: "data_management",
            message: `Cleared ${result.deleted} call records from database`,
            severity: "success",
            metadata: JSON.stringify({ deleted_count: result.deleted }),
          }),
        });
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to clear call records",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to clear call records",
        variant: "destructive",
      });
    } finally {
      setIsClearing(false);
    }
  };

  const handleTestConnection = async () => {
    // First save the current config if changed
    if (localConfig.pbx_ip !== config?.pbx_ip || 
        localConfig.api_username !== config?.api_username || 
        localConfig.api_password !== config?.api_password) {
      await handleSave();
    }

    setIsTesting(true);
    setConnectionStatus('idle');

    try {
      // Use the real PBX API test endpoint
      const response = await fetch(`${apiUrl}/api/pbx-test`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const result = await response.json();

      if (result.success) {
        setConnectionStatus('success');
        toast({
          title: "PBX Connection Successful!",
          description: `✅ S100 PBX at ${localConfig.pbx_ip} - Authentication successful (Token: ${result.token})`,
        });

        // Log successful test
        await fetch(`${apiUrl}/api/activity-logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: "pbx_test",
            message: `PBX connection test successful for ${localConfig.pbx_ip}`,
            severity: "success",
            metadata: JSON.stringify({ pbx_ip: localConfig.pbx_ip, status: result.status }),
          }),
        });
      } else {
        setConnectionStatus('error');
        toast({
          title: "PBX Connection Failed",
          description: `❌ ${result.error || 'Unknown error during connection test'}`,
          variant: "destructive",
        });

        // Log failed test
        await fetch(`${apiUrl}/api/activity-logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: "pbx_test",
            message: `PBX connection test failed for ${localConfig.pbx_ip}`,
            severity: "error",
            metadata: JSON.stringify({ pbx_ip: localConfig.pbx_ip, error: result.error }),
          }),
        });
      }
    } catch (error) {
      setConnectionStatus('error');
      const errorMessage = error instanceof Error ? error.message : "Failed to test connection";
      toast({
        title: "Test failed",
        description: `❌ ${errorMessage}`,
        variant: "destructive",
      });

      // Log connection error
      await fetch(`${apiUrl}/api/activity-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: "pbx_test",
          message: `PBX connection test error: ${errorMessage}`,
          severity: "error",
          metadata: JSON.stringify({ pbx_ip: localConfig.pbx_ip }),
        }),
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
        <Phone className="w-4 h-4 text-muted-foreground" />
        <Label className="text-muted-foreground font-medium">S100 PBX Settings</Label>
      </div>
      
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="pbx-ip" className="text-xs text-muted-foreground">
            PBX IP Address
          </Label>
          <Input
            id="pbx-ip"
            value={localConfig.pbx_ip}
            onChange={(e) => {
              setLocalConfig((prev) => ({ ...prev, pbx_ip: e.target.value }));
              setConnectionStatus('idle');
            }}
            className="font-mono text-sm h-9 bg-muted/50 border-border/50"
            placeholder="192.168.1.200"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="pbx-port" className="text-xs text-muted-foreground">
            SIP Port
          </Label>
          <Input
            id="pbx-port"
            type="number"
            value={localConfig.pbx_port}
            onChange={(e) => {
              setLocalConfig((prev) => ({ ...prev, pbx_port: parseInt(e.target.value) || 5060 }));
              setConnectionStatus('idle');
            }}
            className="font-mono text-sm h-9 bg-muted/50 border-border/50"
            placeholder="5060"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="web-port" className="text-xs text-muted-foreground">
            Web UI Port
          </Label>
          <Input
            id="web-port"
            type="number"
            value={localConfig.web_port}
            onChange={(e) => {
              setLocalConfig((prev) => ({ ...prev, web_port: parseInt(e.target.value) || 8333 }));
              setConnectionStatus('idle');
            }}
            className="font-mono text-sm h-9 bg-muted/50 border-border/50"
            placeholder="8333"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="pbx-username" className="text-xs text-muted-foreground">
            API Username
          </Label>
          <Input
            id="pbx-username"
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

        <div className="space-y-1 sm:col-span-2 lg:col-span-2">
          <Label htmlFor="pbx-password" className="text-xs text-muted-foreground">
            API Password
          </Label>
          <div className="relative max-w-xs">
            <Input
              id="pbx-password"
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

      <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          onClick={handleClearCalls}
          disabled={isClearing}
          className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          {isClearing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
          {isClearing ? "Clearing..." : "Clear Call Records"}
        </Button>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestConnection}
            disabled={isTesting || !localConfig.pbx_ip}
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
            {updateConfig.isPending ? "Saving..." : "Save PBX Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
};
