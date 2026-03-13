import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Send, MessageSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

interface SendReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SendReportDialog = ({ open, onOpenChange }: SendReportDialogProps) => {
  const [isSendingTelegram, setIsSendingTelegram] = useState(false);
  const [isSendingSms, setIsSendingSms] = useState(false);

  const handleSendTelegram = async () => {
    setIsSendingTelegram(true);
    try {
      const res = await fetch(`${API_URL}/api/telegram-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "system_summary" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed");
      toast.success("System summary sent to Telegram");
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send Telegram report");
    } finally {
      setIsSendingTelegram(false);
    }
  };

  const handleSendSms = async () => {
    setIsSendingSms(true);
    try {
      const res = await fetch(`${API_URL}/api/manual-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed");
      toast.success("Manual report sent via SMS");
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send SMS report");
    } finally {
      setIsSendingSms(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send System Report</DialogTitle>
          <DialogDescription>
            Send a system report via Telegram or SMS to configured recipients.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 mt-2">
          <Button
            onClick={handleSendTelegram}
            disabled={isSendingTelegram}
            className="w-full"
          >
            {isSendingTelegram ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Send System Summary via Telegram
          </Button>
          <Button
            variant="outline"
            onClick={handleSendSms}
            disabled={isSendingSms}
            className="w-full"
          >
            {isSendingSms ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <MessageSquare className="w-4 h-4 mr-2" />
            )}
            Send Manual Report via SMS
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
