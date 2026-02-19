import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Trash2, TestTube, CheckCircle, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

interface SmsGateway {
  id?: string;
  url: string;
}

export const SmsGatewayUrlsForm = () => {
  const [gateways, setGateways] = useState<SmsGateway[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  // Load SMS gateway URLs on mount
  useEffect(() => {
    const loadGateways = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:2003";
        const response = await fetch(`${apiUrl}/api/gateway-status`);
        if (response.ok) {
          const result = await response.json();
          if (result.data?.gateway_ip) {
            // Set default gateway URL if configured
            setGateways([{ url: `http://${result.data.gateway_ip}:${result.data.gateway_port || 8088}` }]);
          }
        }
      } catch (error) {
        console.error("Error loading SMS gateways:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadGateways();
  }, []);

  const handleAddUrl = () => {
    if (!newUrl.trim()) {
      toast.error("Please enter a URL");
      return;
    }

    // Basic URL validation
    try {
      new URL(newUrl);
    } catch {
      toast.error("Invalid URL format");
      return;
    }

    const isDuplicate = gateways.some(g => g.url === newUrl);
    if (isDuplicate) {
      toast.error("This URL is already added");
      return;
    }

    setGateways([...gateways, { url: newUrl }]);
    setNewUrl("");
    toast.success("URL added");
  };

  const handleRemoveUrl = (index: number) => {
    setGateways(gateways.filter((_, i) => i !== index));
    toast.success("URL removed");
  };

  const handleTestUrl = async (index: number) => {
    const gateway = gateways[index];
    const testId = `test-${index}-${Date.now()}`;
    setTestingId(testId);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:2003";
      const response = await fetch(`${apiUrl}/api/test-sms-gateway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: gateway.url }),
      });

      const result = await response.json();
      const testResult = {
        success: response.ok,
        message: result.message || (response.ok ? "Connection successful" : "Connection failed"),
      };

      setTestResults(prev => ({
        ...prev,
        [index]: testResult,
      }));

      if (testResult.success) {
        toast.success(`Test successful: ${gateway.url}`);
      } else {
        toast.error(`Test failed: ${testResult.message}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      setTestResults(prev => ({
        ...prev,
        [index]: { success: false, message: errorMsg },
      }));
      toast.error(`Test error: ${errorMsg}`);
    } finally {
      setTestingId(null);
    }
  };

  const handleSave = async () => {
    if (gateways.length === 0) {
      toast.error("Please add at least one SMS gateway URL");
      return;
    }

    setIsSaving(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:2003";
      
      // Save each gateway URL
      for (const gateway of gateways) {
        const response = await fetch(`${apiUrl}/api/sms-gateway-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: gateway.url }),
        });

        if (!response.ok) {
          throw new Error(`Failed to save gateway: ${gateway.url}`);
        }
      }

      toast.success("SMS gateway URLs saved successfully");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Error saving configuration: ${errorMsg}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add New URL Section */}
      <div className="space-y-3 p-4 border border-border/50 rounded-lg bg-muted/30">
        <Label className="text-sm">Add SMS Gateway URL</Label>
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="http://192.168.1.1:8088"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleAddUrl()}
          />
          <Button
            size="sm"
            onClick={handleAddUrl}
            variant="outline"
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </div>
      </div>

      {/* Gateway URLs List */}
      {gateways.length > 0 && (
        <div className="space-y-3">
          <Label className="text-sm">Configured SMS Gateways</Label>
          <div className="space-y-2">
            {gateways.map((gateway, index) => (
              <div key={index} className="flex items-start gap-3 p-3 border border-border/50 rounded-lg bg-card">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono break-all text-foreground">{gateway.url}</p>
                  
                  {testResults[index] && (
                    <div className="flex items-center gap-1 mt-1">
                      {testResults[index].success ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-500" />
                      )}
                      <p className="text-xs text-muted-foreground">
                        {testResults[index].message}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTestUrl(index)}
                    disabled={testingId === `test-${index}-${Date.now()}`}
                    className="gap-1"
                  >
                    {testingId === `test-${index}` ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4" />
                    )}
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRemoveUrl(index)}
                    className="gap-1 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {gateways.length === 0 && (
        <Alert className="border-border/50">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>
            No SMS gateway URLs configured. Add at least one to enable SMS functionality.
          </AlertDescription>
        </Alert>
      )}

      {/* Save Button */}
      <div className="flex justify-end pt-4">
        <Button
          onClick={handleSave}
          disabled={isSaving || gateways.length === 0}
          className="gap-2"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : null}
          {isSaving ? "Saving..." : "Save Gateway URLs"}
        </Button>
      </div>
    </div>
  );
};
