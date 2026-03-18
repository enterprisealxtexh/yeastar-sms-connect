import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Eye, EyeOff, Server } from "lucide-react";
import { usePbxConfig } from "@/hooks/usePbxConfig";
import { toast } from "sonner";
import { apiCall, apiFetch } from "@/lib/api-client";

export const PbxSettingsForm = () => {
  const { config, isLoading, updateConfig } = usePbxConfig();
  const [showPassword, setShowPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [localConfig, setLocalConfig] = useState({
    pbx_ip: "",
    pbx_port: 5060,
    api_username: "",
    api_password: "",
  });

  useEffect(() => {
    if (config) {
      setLocalConfig({
        pbx_ip: config.pbx_ip || "",
        pbx_port: config.pbx_port || 5060,
        api_username: config.api_username || "",
        api_password: config.api_password || "",
      });
    }
  }, [config]);

  const handleSave = async () => {
    if (!localConfig.pbx_ip) {
      toast.error("PBX IP address is required");
      return;
    }

    try {
      await updateConfig.mutateAsync(localConfig);

      // Log to local API
      await apiCall('/api/activity-logs', {
        method: "POST",
        body: JSON.stringify({
          event_type: "pbx_config_update",
          message: "PBX S100 configuration updated",
          severity: "info",
        }),
      }).catch(() => {});
    } catch (error) {
      console.error('Save error:', error);
      toast.error(error instanceof Error ? error.message : "Failed to save PBX settings");
    }
  };

  const handleTestConnection = async () => {
    // First save the current config
    if (localConfig.pbx_ip !== config?.pbx_ip || 
        localConfig.api_username !== config?.api_username || 
        localConfig.api_password !== config?.api_password) {
      await handleSave();
    }

    setIsTesting(true);

    try {
      const result = await apiFetch<any>('/api/pbx-test');

      if (result.success || result.status === 'Connected') {
        toast.success(`Connected to PBX at ${localConfig.pbx_ip}:${localConfig.pbx_port}`);
      } else {
        toast.error(result.error || "Failed to connect to PBX");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Test failed";
      toast.error(errorMsg);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* PBX IP Address */}
        <div className="space-y-2">
          <Label htmlFor="pbx_ip">PBX IP Address</Label>
          <Input
            id="pbx_ip"
            type="text"
            placeholder="192.168.5.2"
            value={localConfig.pbx_ip}
            onChange={(e) => setLocalConfig({ ...localConfig, pbx_ip: e.target.value })}
            disabled={isLoading}
          />
        </div>

        {/* PBX Port */}
        <div className="space-y-2">
          <Label htmlFor="pbx_port">Port</Label>
          <Input
            id="pbx_port"
            type="number"
            placeholder="5060"
            value={localConfig.pbx_port}
            onChange={(e) => setLocalConfig({ ...localConfig, pbx_port: parseInt(e.target.value) || 5060 })}
            disabled={isLoading}
          />
        </div>

        {/* API Username */}
        <div className="space-y-2">
          <Label htmlFor="api_username">API Username</Label>
          <Input
            id="api_username"
            type="text"
            placeholder="admin"
            value={localConfig.api_username}
            onChange={(e) => setLocalConfig({ ...localConfig, api_username: e.target.value })}
            disabled={isLoading}
            autoComplete="off"
          />
        </div>

        {/* API Password */}
        <div className="space-y-2">
          <Label htmlFor="api_password">API Password</Label>
          <div className="relative">
            <Input
              id="api_password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={localConfig.api_password}
              onChange={(e) => setLocalConfig({ ...localConfig, api_password: e.target.value })}
              disabled={isLoading}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={isLoading}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button
          onClick={handleSave}
          disabled={isLoading || updateConfig.isPending}
          className="gap-2"
        >
          {isLoading || updateConfig.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {updateConfig.isPending ? "Saving..." : "Save Configuration"}
        </Button>

        <Button
          onClick={handleTestConnection}
          disabled={isTesting || !localConfig.pbx_ip}
          variant="outline"
          className="gap-2"
        >
          {isTesting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Server className="w-4 h-4" />
          )}
          {isTesting ? "Testing..." : "Test Connection"}
        </Button>
      </div>
    </div>
  );
};
