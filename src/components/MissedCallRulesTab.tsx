import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { useMissedCallRules } from "@/hooks/useMissedCallRules";
import { useSmsGateways } from "@/hooks/useSmsGateways";
import { useSmsTemplates } from "@/hooks/useSmsTemplates";
import { TemplateModal } from "./TemplateModal";
import { useExtensions } from "@/hooks/useExtensions";
import { toast } from "sonner";

export const MissedCallRulesTab = () => {
  const [isCreating, setIsCreating] = useState(false);
  const [selectedExtensions, setSelectedExtensions] = useState<string[]>([]);
  const [threshold, setThreshold] = useState("3");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedGateway, setSelectedGateway] = useState("");

  const { rules, isLoading, isCreating: isSubmitting, isDeleting, createRule, deleteRule } = useMissedCallRules();
  const { gateways } = useSmsGateways();
  const { templates } = useSmsTemplates();
  const { extensions } = useExtensions();

  const handleAddRule = () => {
    if (selectedExtensions.length === 0) {
      toast.error("Select at least one extension");
      return;
    }
    if (!threshold || parseInt(threshold) < 1) {
      toast.error("Threshold must be at least 1");
      return;
    }
    if (!selectedTemplate) {
      toast.error("Select a template");
      return;
    }
    if (!selectedGateway) {
      toast.error("Select a gateway");
      return;
    }

    createRule(
      {
        extensions: selectedExtensions,
        threshold: parseInt(threshold),
        template_id: selectedTemplate,
        gateway_id: selectedGateway,
      },
      {
        onSuccess: () => {
          toast.success("Rule created");
          resetForm();
        },
        onError: (error: any) => {
          toast.error(error.message || "Failed to create rule");
        },
      }
    );
  };

  const resetForm = () => {
    setIsCreating(false);
    setSelectedExtensions([]);
    setThreshold("3");
    setSelectedTemplate("");
    setSelectedGateway("");
  };

  const toggleExtension = (ext: string) => {
    setSelectedExtensions((prev) =>
      prev.includes(ext) ? prev.filter((e) => e !== ext) : [...prev, ext]
    );
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading rules...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Create New Rule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            {isCreating ? "Create New Rule" : "Add Missed Call Rule"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isCreating ? (
            <>
              {/* Extensions Selection */}
              <div>
                <Label className="mb-3 block">Select Extensions to Monitor</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {extensions.map((ext) => (
                    <div key={ext.extnumber} className="flex items-center space-x-2">
                      <Checkbox
                        id={ext.extnumber}
                        checked={selectedExtensions.includes(ext.extnumber)}
                        onCheckedChange={() => toggleExtension(ext.extnumber)}
                      />
                      <Label
                        htmlFor={ext.extnumber}
                        className="font-normal cursor-pointer flex-1"
                      >
                        {ext.extnumber}
                        {ext.username && <span className="text-xs text-muted-foreground ml-1">({ext.username})</span>}
                      </Label>
                    </div>
                  ))}
                </div>
                {selectedExtensions.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Selected: {selectedExtensions.join(", ")}
                  </p>
                )}
              </div>

              <Separator />

              {/* Threshold */}
              <div>
                <Label htmlFor="threshold">Missed Call Threshold</Label>
                <Input
                  id="threshold"
                  type="number"
                  min="1"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  placeholder="3"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  SMS will be sent after this many missed calls from the same number
                </p>
              </div>

              {/* Gateway Selection */}
              <div>
                <Label htmlFor="gateway">SMS Gateway</Label>
                <Select value={selectedGateway} onValueChange={setSelectedGateway}>
                  <SelectTrigger id="gateway">
                    <SelectValue placeholder="Select gateway" />
                  </SelectTrigger>
                  <SelectContent>
                    {gateways.map((gw) => (
                      <SelectItem key={gw.id} value={gw.id}>
                        {gw.url.substring(0, 50)}...
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Template Selection */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label htmlFor="template">SMS Template</Label>
                  <TemplateModal />
                </div>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger id="template">
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleAddRule} className="flex-1" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Rule"}
                </Button>
                <Button variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button
              onClick={() => setIsCreating(true)}
              className="w-full"
              disabled={gateways.length === 0 || extensions.length === 0}
            >
              <Plus className="w-4 h-4 mr-2" />
              New Rule
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Rules List */}
      <Card>
        <CardHeader>
          <CardTitle>Active Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              No rules configured yet
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((rule, idx) => {
                const gateway = gateways.find((g) => g.id === rule.gateway_id);
                const template = templates.find((t) => t.id === rule.template_id);
                return (
                  <div key={rule.id}>
                    <div className="p-3 bg-secondary/50 rounded-lg space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-semibold text-sm">
                            Extensions: {rule.extensions.join(", ")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Threshold: {rule.threshold} missed calls
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Template: {template?.name || "Unknown"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            Gateway: {gateway?.url.substring(0, 40) || "Unknown"}...
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            deleteRule(rule.id, {
                              onSuccess: () => toast.success("Rule deleted"),
                              onError: (error: any) =>
                                toast.error(error.message || "Failed to delete rule"),
                            });
                          }}
                          disabled={isDeleting}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    {idx < rules.length - 1 && <Separator className="my-2" />}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
