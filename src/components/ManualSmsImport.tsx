import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, Plus, FileText } from "lucide-react";
import { apiClient } from "@/integrations/supabase/api-client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export const ManualSmsImport = () => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  // Single message form
  const [senderNumber, setSenderNumber] = useState("");
  const [messageContent, setMessageContent] = useState("");
  const [simPort, setSimPort] = useState("1");

  // Bulk import
  const [bulkData, setBulkData] = useState("");

  const handleSingleSubmit = async () => {
    if (!senderNumber.trim() || !messageContent.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await apiClient.saveSmsMessage({
        sender_number: senderNumber.trim(),
        message_content: messageContent.trim(),
        sim_port: parseInt(simPort),
        status: "unread",
        external_id: `manual-${Date.now()}`,
      });

      if (error) throw error;

      toast.success("SMS added successfully");
      queryClient.invalidateQueries({ queryKey: ["sms-messages"] });
      
      // Reset form
      setSenderNumber("");
      setMessageContent("");
      setSimPort("1");
      setOpen(false);
    } catch (error) {
      toast.error("Failed to add SMS");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkSubmit = async () => {
    if (!bulkData.trim()) {
      toast.error("Please enter data to import");
      return;
    }

    setIsSubmitting(true);
    try {
      // Parse CSV or JSON format
      let messages: Array<{
        sender_number: string;
        message_content: string;
        sim_port: number;
      }> = [];

      // Try JSON first
      try {
        const parsed = JSON.parse(bulkData);
        messages = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // Fall back to CSV parsing
        const lines = bulkData.trim().split("\n");
        const hasHeader = lines[0].toLowerCase().includes("sender") || 
                          lines[0].toLowerCase().includes("number");
        
        const dataLines = hasHeader ? lines.slice(1) : lines;
        
        messages = dataLines.map((line, index) => {
          const parts = line.split(",").map(p => p.trim().replace(/^["']|["']$/g, ""));
          return {
            sender_number: parts[0] || `Unknown-${index}`,
            message_content: parts[1] || "",
            sim_port: parseInt(parts[2]) || 1,
          };
        }).filter(m => m.message_content);
      }

      if (messages.length === 0) {
        toast.error("No valid messages found in data");
        return;
      }

      // Add metadata to each message
      const messagesWithMeta = messages.map((m, i) => ({
        ...m,
        status: "unread" as const,
        external_id: `manual-bulk-${Date.now()}-${i}`,
      }));

      // Bulk save using local API
      const { error } = await apiClient.saveBulkSmsMessages(messagesWithMeta);

      if (error) throw error;

      toast.success(`Successfully imported ${messagesWithMeta.length} message(s)`);
      queryClient.invalidateQueries({ queryKey: ["sms-messages"] });
      
      setBulkData("");
      setOpen(false);
    } catch (error) {
      toast.error("Failed to import messages");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Upload className="h-4 w-4" />
          Import SMS
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import SMS Messages</DialogTitle>
          <DialogDescription>
            Manually add SMS messages when automatic sync isn't available.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <Button
            variant={mode === "single" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("single")}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Single
          </Button>
          <Button
            variant={mode === "bulk" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("bulk")}
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            Bulk Import
          </Button>
        </div>

        {mode === "single" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sender">Sender Number</Label>
                <Input
                  id="sender"
                  placeholder="+1234567890"
                  value={senderNumber}
                  onChange={(e) => setSenderNumber(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">SIM Port</Label>
                <Select value={simPort} onValueChange={setSimPort}>
                  <SelectTrigger id="port">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4].map((port) => (
                      <SelectItem key={port} value={port.toString()}>
                        Port {port}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message Content</Label>
              <Textarea
                id="message"
                placeholder="Enter the SMS content..."
                value={messageContent}
                onChange={(e) => setMessageContent(e.target.value)}
                rows={4}
              />
            </div>
            <Button
              onClick={handleSingleSubmit}
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? "Adding..." : "Add Message"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bulk">Paste CSV or JSON Data</Label>
              <Textarea
                id="bulk"
                placeholder={`CSV format:\nsender_number,message_content,sim_port\n+1234567890,Hello world,1\n\nOr JSON format:\n[{"sender_number": "+1234567890", "message_content": "Hello", "sim_port": 1}]`}
                value={bulkData}
                onChange={(e) => setBulkData(e.target.value)}
                rows={8}
                className="font-mono text-sm"
              />
            </div>
            <Button
              onClick={handleBulkSubmit}
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? "Importing..." : "Import Messages"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
