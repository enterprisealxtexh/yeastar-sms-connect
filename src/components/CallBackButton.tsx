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
import { useInitiateCall } from "@/hooks/useCallQueue";
import { useSimPorts } from "@/hooks/useSimPorts";

interface CallBackButtonProps {
  phoneNumber: string;
  variant?: "default" | "ghost" | "outline";
  size?: "default" | "sm" | "icon";
}

export const CallBackButton = ({ phoneNumber, variant = "ghost", size = "icon" }: CallBackButtonProps) => {
  const [open, setOpen] = useState(false);
  const [selectedExtension, setSelectedExtension] = useState("");
  const { mutate: initiateCall, isPending } = useInitiateCall();
  const { data: simPortsData } = useSimPorts();

  const configs = simPortsData?.configs || [];
  const enabledConfigs = configs.filter(c => c.enabled && c.extension);

  const handleCall = () => {
    if (!selectedExtension) return;
    
    initiateCall(
      {
        fromExtension: selectedExtension,
        toNumber: phoneNumber,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setSelectedExtension("");
        },
      }
    );
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
            <Select value={selectedExtension} onValueChange={setSelectedExtension}>
              <SelectTrigger id="from-ext">
                <SelectValue placeholder="Select extension to call from" />
              </SelectTrigger>
              <SelectContent>
                {enabledConfigs.map((config) => (
                  <SelectItem key={config.id} value={config.extension!}>
                    {config.extension} - {config.label || `Port ${config.port_number}`}
                  </SelectItem>
                ))}
                {enabledConfigs.length === 0 && (
                  <SelectItem value="none" disabled>
                    No extensions configured
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCall}
            disabled={!selectedExtension || isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Phone className="h-4 w-4 mr-2" />
            )}
            Call
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
