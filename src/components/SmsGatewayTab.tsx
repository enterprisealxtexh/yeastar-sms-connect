import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { useSmsGateways } from "@/hooks/useSmsGateways";
import { toast } from "sonner";

export const SmsGatewayTab = () => {
  const [urlInput, setUrlInput] = useState("");
  const { gateways, isLoading, isCreating, isDeleting, createGateway, deleteGateway } = useSmsGateways();

  const handleAddGateway = () => {
    if (!urlInput.trim()) {
      toast.error("Gateway URL is required");
      return;
    }

    if (!urlInput.includes("{") || !urlInput.includes("}")) {
      toast.error("URL must contain template variables like {url}, {userid}, etc.");
      return;
    }

    createGateway(urlInput, {
      onSuccess: () => {
        toast.success("Gateway added");
        setUrlInput("");
      },
      onError: (error: any) => {
        toast.error(error.message || "Failed to add gateway");
      },
    });
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading gateways...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Add New Gateway */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add SMS Gateway
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Gateway URL Template</Label>
            <Input
              placeholder="https://{url}/send-sms?userid={userid}&apiKey={apikey}&mobile={phonenumber}&senderid={senderid}&msg={msg}"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Use placeholders: {"{url}"}, {"{userid}"}, {"{apikey}"}, {"{phonenumber}"}, {"{senderid}"}, {"{msg}"}
            </p>
          </div>
          <Button onClick={handleAddGateway} disabled={isCreating} className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            {isCreating ? "Adding..." : "Add Gateway"}
          </Button>
        </CardContent>
      </Card>

      {/* Gateways List */}
      <Card>
        <CardHeader>
          <CardTitle>Configured Gateways</CardTitle>
        </CardHeader>
        <CardContent>
          {gateways.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              No gateways configured yet
            </div>
          ) : (
            <div className="space-y-3">
              {gateways.map((gateway, idx) => (
                <div key={gateway.id}>
                  <div className="flex items-start gap-3 p-3 bg-secondary/50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono break-all text-xs">{gateway.url}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Added: {new Date(gateway.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        deleteGateway(gateway.id, {
                          onSuccess: () => toast.success("Gateway deleted"),
                          onError: (error: any) =>
                            toast.error(error.message || "Failed to delete gateway"),
                        });
                      }}
                      disabled={isDeleting}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                  {idx < gateways.length - 1 && <Separator className="my-2" />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
