import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Edit2 } from "lucide-react";
import { useSmsTemplates } from "@/hooks/useSmsTemplates";
import { toast } from "sonner";

interface TemplateModalProps {
  onTemplateSelected?: (templateId: string) => void;
}

export const TemplateModal = ({ onTemplateSelected }: TemplateModalProps) => {
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const { templates, isLoading, isCreating: isSubmitting, isDeleting, createTemplate, updateTemplate, deleteTemplate } = useSmsTemplates();

  const handleSubmit = () => {
    if (!name.trim() || !message.trim()) {
      toast.error("Template name and message are required");
      return;
    }

    if (editingId) {
      updateTemplate(
        { id: editingId, name, message, active: true },
        {
          onSuccess: () => {
            toast.success("Template updated");
            resetForm();
          },
          onError: (error: any) => {
            toast.error(error.message || "Failed to update template");
          },
        }
      );
    } else {
      createTemplate(
        { name, message },
        {
          onSuccess: () => {
            toast.success("Template created");
            resetForm();
          },
          onError: (error: any) => {
            toast.error(error.message || "Failed to create template");
          },
        }
      );
    }
  };

  const resetForm = () => {
    setName("");
    setMessage("");
    setEditingId(null);
    setIsCreating(false);
  };

  const handleEdit = (template: any) => {
    setEditingId(template.id);
    setName(template.name);
    setMessage(template.message);
    setIsCreating(true);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          Manage Templates
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>SMS Templates</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Create/Edit Template */}
          {isCreating ? (
            <div className="space-y-4 p-4 bg-secondary/50 rounded-lg">
              <h3 className="font-semibold">
                {editingId ? "Edit Template" : "Create New Template"}
              </h3>
              <div className="space-y-3">
                <div>
                  <Label className="text-sm">Template Name</Label>
                  <Input
                    placeholder="e.g., Missed Call Alert"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-sm">Message Template</Label>
                  <Textarea
                    placeholder={`Available variables:\n{phonenumber} - Caller's phone number\n{missedcount} - Number of missed calls\n{extensionname} - Extension ID\n{extensionusername} - Extension owner name`}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="min-h-[120px]"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Use variables: {"{phonenumber}"}, {"{missedcount}"}, {"{extensionname}"}, {"{extensionusername}"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSubmit} className="flex-1" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : editingId ? "Update Template" : "Create Template"}
                </Button>
                <Button variant="outline" onClick={resetForm} disabled={isSubmitting}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => {
                setIsCreating(true);
                setEditingId(null);
                setName("");
                setMessage("");
              }}
            >
              <Plus className="w-4 h-4" />
              New Template
            </Button>
          )}

          <Separator />

          {/* Templates List */}
          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No templates yet. Create one to get started!
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="p-3 border rounded-lg space-y-2 hover:bg-secondary/50 transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{template.name}</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{template.message}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(template)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          deleteTemplate(template.id, {
                            onSuccess: () => toast.success("Template deleted"),
                            onError: (error: any) =>
                              toast.error(error.message || "Failed to delete template"),
                          });
                        }}
                        disabled={isDeleting}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
