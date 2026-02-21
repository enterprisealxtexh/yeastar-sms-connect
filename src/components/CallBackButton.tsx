import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Phone, Loader2 } from "lucide-react";
import { useExtensions } from "@/hooks/useExtensions";
import { toast } from "@/hooks/use-toast";

interface CallBackButtonProps {
  phoneNumber: string;
  variant?: "default" | "ghost" | "outline";
  size?: "default" | "sm" | "icon";
}

export const CallBackButton = ({ phoneNumber, variant = "ghost", size = "icon" }: CallBackButtonProps) => {
  const [open, setOpen] = useState(false);
  const [selectedExtension, setSelectedExtension] = useState("");
  const [isPending, setIsPending] = useState(false);
  const { extensions, isLoading } = useExtensions();

  const initiateCall = async (fromExtension: string, toNumber: string) => {
    setIsPending(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/pbx-call/dial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caller: fromExtension,
          callee: toNumber,
          autoanswer: "no"
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "✅ Call Initiated",
          description: `Calling ${toNumber} from extension ${fromExtension}${data.data?.callid ? ` (ID: ${data.data.callid})` : ''}`,
        });
        return { success: true };
      } else {
        throw new Error(data.error || "Failed to initiate call");
      }
    } catch (error) {
      toast({
        title: "❌ Call Failed",
        description: error instanceof Error ? error.message : "Unable to initiate call. Please try again.",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  const handleCall = async () => {
    if (!selectedExtension) return;
    
    try {
      await initiateCall(selectedExtension, phoneNumber);
      setOpen(false);
      setSelectedExtension("");
    } catch (error) {
      // Error already handled in initiateCall
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} title={`Call ${phoneNumber}`}>
          <Phone className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>Call Back</DialogTitle>
          <DialogDescription>
            Initiate a call to <span className="font-mono font-semibold">{phoneNumber}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="from-ext">From Extension</Label>
            <Select value={selectedExtension} onValueChange={setSelectedExtension} disabled={isLoading || isPending}>
              <SelectTrigger id="from-ext">
                <SelectValue placeholder={isLoading ? "Loading..." : "Select extension"} />
              </SelectTrigger>
              <SelectContent>
                {extensions.map((ext) => (
                  <SelectItem key={ext.extnumber} value={ext.extnumber}>
                    {ext.extnumber} - {ext.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Close
          </Button>
          <Button onClick={handleCall} disabled={isPending || !selectedExtension}>
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Phone className="h-4 w-4 mr-2" />}
            {isPending ? "Calling..." : "Call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
