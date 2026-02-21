import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, X, Loader2 } from "lucide-react";
import { useExtensions } from "@/hooks/useExtensions";
import { toast } from "@/hooks/use-toast";

export const QuickDialWidget = () => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedExtension, setSelectedExtension] = useState("");
  const [isDialing, setIsDialing] = useState(false);
  const { extensions, isLoading, getExtensionName } = useExtensions();

  const handleDial = async () => {
    if (!phoneNumber.trim() || !selectedExtension) return;
    
    setIsDialing(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/pbx-call/dial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caller: selectedExtension,
          callee: phoneNumber,
          autoanswer: "no"
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "✅ Call Initiated",
          description: `Calling ${phoneNumber} from extension ${selectedExtension} (Call ID: ${data.data?.callid || 'pending'})`,
        });
        setPhoneNumber("");
      } else {
        throw new Error(data.error || "Failed to initiate call");
      }
    } catch (error) {
      toast({
        title: "❌ Call Failed",
        description: error instanceof Error ? error.message : "Failed to initiate call",
        variant: "destructive",
      });
    } finally {
      setIsDialing(false);
    }
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
          <Select value={selectedExtension} onValueChange={setSelectedExtension} disabled={isLoading || isDialing}>
            <SelectTrigger id="extension">
              <SelectValue placeholder={isLoading ? "Loading..." : "Select extension"} />
            </SelectTrigger>
            <SelectContent>
              {extensions.map((ext) => (
                <SelectItem key={ext.extnumber} value={ext.extnumber}>
                  {ext.extnumber} - {ext.username}
                </SelectItem>
              ))}
              {!isLoading && extensions.length === 0 && (
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
              disabled={isDialing}
            />
            {phoneNumber && (
              <Button variant="ghost" size="icon" onClick={handleClear} disabled={isDialing}>
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
              disabled={isDialing}
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
            disabled={!phoneNumber || isDialing}
          >
            ← Delete
          </Button>
          <Button
            className="flex-1 bg-primary hover:bg-primary/90"
            onClick={handleDial}
            disabled={isDialing || !phoneNumber || !selectedExtension}
          >
            {isDialing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Phone className="h-4 w-4 mr-2" />}
            {isDialing ? "Dialing..." : "Call"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
