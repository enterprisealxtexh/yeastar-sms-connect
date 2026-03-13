import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClockIn, useActiveShifts } from "@/hooks/useAgents";
import { Clock, LogIn, LogOut, Delete } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export const ClockInKiosk = () => {
  const [pin, setPin] = useState("");
  const clockIn = useClockIn();
  const { data: activeShifts = [] } = useActiveShifts();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDigit = (digit: string) => {
    if (pin.length < 6) setPin((p) => p + digit);
  };

  const handleDelete = () => setPin((p) => p.slice(0, -1));

  const handleSubmit = () => {
    if (pin.length >= 4) {
      clockIn.mutate(pin, { onSettled: () => setPin("") });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="max-w-md mx-auto">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-lg">
            <Clock className="w-5 h-5 text-primary" />
            Agent Clock In / Out
          </CardTitle>
          <p className="text-sm text-muted-foreground">Enter your PIN to clock in or out</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center">
            <Input
              ref={inputRef}
              type="password"
              value={pin}
              readOnly
              className="text-center text-2xl tracking-[0.5em] max-w-[200px] font-mono"
              placeholder="• • • •"
            />
          </div>

          {/* Number pad */}
          <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Button key={d} variant="outline" size="lg" onClick={() => handleDigit(d)} className="text-lg font-mono">
                {d}
              </Button>
            ))}
            <Button variant="outline" size="lg" onClick={handleDelete}>
              <Delete className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="lg" onClick={() => handleDigit("0")} className="text-lg font-mono">
              0
            </Button>
            <Button
              size="lg"
              onClick={handleSubmit}
              disabled={pin.length < 4 || clockIn.isPending}
              className="bg-primary text-primary-foreground"
            >
              <LogIn className="w-4 h-4" />
            </Button>
          </div>

          {clockIn.isPending && <p className="text-center text-sm text-muted-foreground">Processing...</p>}
        </CardContent>
      </Card>

      {/* Currently on shift */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <LogOut className="w-4 h-4 text-chart-2" />
            Currently On Shift ({activeShifts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeShifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agents currently on shift</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {activeShifts.map((shift) => (
                <Badge key={shift.id} variant="secondary" className="text-sm py-1 px-3">
                  {shift.agent?.name || "Unknown"} — since{" "}
                  {format(new Date(shift.clock_in), "HH:mm")}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
