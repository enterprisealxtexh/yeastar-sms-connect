import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, X, Loader2 } from "lucide-react";
import { useInitiateCall } from "@/hooks/useCallQueue";
import { useSimPorts } from "@/hooks/useSimPorts";

export const QuickDialWidget = () => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedExtension, setSelectedExtension] = useState("");
  const { mutate: initiateCall, isPending } = useInitiateCall();
  const { data: simPortsData } = useSimPorts();

  const configs = simPortsData?.configs || [];
  const enabledConfigs = configs.filter(c => c.enabled && c.extension);

  const handleDial = () => {
    if (!phoneNumber.trim() || !selectedExtension) return;
    
    initiateCall({
      fromExtension: selectedExtension,
      toNumber: phoneNumber.trim(),
    });
    
    setPhoneNumber("");
  };

  const handleKeypadClick = (digit: string) => {
    setPhoneNumber((prev) => prev + digit);
  };

  const handleClear = () => {
    setPhoneNumber("");
  };

  const handleBackspace = () => {
    setPhoneNumber((prev) => prev.slice(0, -1));
  };

  const keypadDigits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Phone className="h-5 w-5" />
          Quick Dial
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Extension selector */}
        <div className="space-y-2">
          <Label htmlFor="extension">From Extension</Label>
          <Select value={selectedExtension} onValueChange={setSelectedExtension}>
            <SelectTrigger id="extension">
              <SelectValue placeholder="Select extension" />
            </SelectTrigger>
            <SelectContent>
              {enabledConfigs.map((config) => (
                <SelectItem key={config.id} value={config.extension!}>
                  {config.extension} - {config.label || `Port ${config.port_number}`}
                </SelectItem>
              ))}
              {enabledConfigs.length === 0 && (
                <SelectItem value="default" disabled>
                  No extensions configured
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Phone number input */}
        <div className="space-y-2">
          <Label htmlFor="phone">Phone Number</Label>
          <div className="flex gap-2">
            <Input
              id="phone"
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Enter phone number"
              className="text-lg font-mono"
            />
            {phoneNumber && (
              <Button variant="ghost" size="icon" onClick={handleClear}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {keypadDigits.map((digit) => (
            <Button
              key={digit}
              variant="outline"
              className="h-12 text-lg font-semibold"
              onClick={() => handleKeypadClick(digit)}
            >
              {digit}
            </Button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleBackspace}
            disabled={!phoneNumber}
          >
            ← Delete
          </Button>
          <Button
            className="flex-1 bg-primary hover:bg-primary/90"
            onClick={handleDial}
            disabled={!phoneNumber.trim() || !selectedExtension || isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Phone className="h-4 w-4 mr-2" />
            )}
            Call
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
