import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Edit2, Loader2, Save, CheckCircle2, Send, Mail } from "lucide-react";
import { toast } from "sonner";

const EVENT_DEFS = [
  {
    eventType: 'missed_call',
    label: 'Missed Calls',
    description: 'Alert when an inbound call goes unanswered',
    vars: ['{caller}', '{extension}', '{extension_name}', '{time}', '{date}', '{duration}'],
  },
  {
    eventType: 'new_sms',
    label: 'New SMS Messages',
    description: 'Alert when a new inbound SMS is received',
    vars: ['{caller}', '{port}', '{time}', '{message}'],
  },
  {
    eventType: 'system_error',
    label: 'System Errors',
    description: 'Alert on critical system faults or save failures',
    vars: ['{error_type}', '{error_message}', '{time}'],
  },
  {
    eventType: 'shift_change',
    label: 'Shift Changes',
    description: 'Alert on clock-in, clock-out, swap requests',
    vars: ['{action}', '{agent}', '{time}'],
  },
  {
    eventType: 'daily_report',
    label: 'Daily Report',
    description: 'Automated daily performance summary',
    vars: ['{date}', '{time}'],
  },
] as const;

interface TemplateModalProps {
  onTemplateSelected?: (templateId: string) => void;
  notifTemplates?: Record<string, string>;
  onSaveNotifTemplate?: (eventType: string, text: string) => Promise<void>;
}

export const TemplateModal = ({ notifTemplates = {}, onSaveNotifTemplate }: TemplateModalProps) => {
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const openEdit = (key: string) => {
    setDraft(notifTemplates[key] || '');
    setEditingKey(key);
  };

  const closeEdit = () => { setEditingKey(null); setDraft(''); };

  const handleSave = async (key: string) => {
    if (!onSaveNotifTemplate) return;
    setSaving(true);
    try {
      await onSaveNotifTemplate(key, draft);
      closeEdit();
    } catch (e) {
      // error toasted upstream
    } finally {
      setSaving(false);
    }
  };

  const renderEventList = (prefix: 'tg' | 'email') => (
    <div className="space-y-3">
      {EVENT_DEFS.map(({ eventType, label, description, vars }) => {
        const key = `${prefix}_${eventType}`;
        const hasTemplate = !!(notifTemplates[key]?.trim());
        const isEditing = editingKey === key;
        return (
          <div key={key} className="border rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium">{label}</p>
                  {hasTemplate ? (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/30">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Customised
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              {!isEditing && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 shrink-0"
                  onClick={() => openEdit(key)}
                >
                  <Edit2 className="w-3 h-3" />
                  Edit
                </Button>
              )}
            </div>

            {!isEditing && hasTemplate && (
              <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap bg-muted/40 rounded p-2 font-mono leading-relaxed">
                {notifTemplates[key]}
              </pre>
            )}

            {isEditing && (
              <div className="space-y-2 pt-1">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Click to insert variable:</p>
                  <div className="flex flex-wrap gap-1">
                    {vars.map((v) => (
                      <code
                        key={v}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-background border cursor-pointer hover:bg-accent transition font-mono"
                        onClick={() => setDraft((t) => t + v)}
                      >
                        {v}
                      </code>
                    ))}
                  </div>
                </div>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="min-h-[100px] text-xs font-mono"
                  placeholder="Enter message template…"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => handleSave(key)}
                    disabled={saving || !draft.trim()}
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={closeEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          Manage Templates
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Notification Templates</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Customise message templates per channel. Saves are independent — Telegram and Email can have different wording.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="telegram" className="flex-1 overflow-hidden flex flex-col min-h-0 mt-2">
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="telegram" className="flex-1 gap-2">
              <Send className="w-3.5 h-3.5" /> Telegram
            </TabsTrigger>
            <TabsTrigger value="email" className="flex-1 gap-2">
              <Mail className="w-3.5 h-3.5" /> Email
            </TabsTrigger>
          </TabsList>

          <TabsContent value="telegram" className="flex-1 overflow-y-auto mt-4 pr-1">
            <p className="text-xs text-muted-foreground mb-3">
              These templates are used for <strong>Telegram bot</strong> alerts.
            </p>
            {renderEventList('tg')}
          </TabsContent>

          <TabsContent value="email" className="flex-1 overflow-y-auto mt-4 pr-1">
            <p className="text-xs text-muted-foreground mb-3">
              These templates are used for <strong>Email</strong> alerts.
            </p>
            {renderEventList('email')}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
