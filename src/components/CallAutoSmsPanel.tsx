import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Save, PhoneMissed, PhoneCall, MessageSquare, Clock, Smartphone, Users, ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from "lucide-react";
import { useCallAutoSmsConfig, useUpdateCallAutoSmsConfig } from "@/hooks/useCallAutoSmsConfig";
import { usePortLabels, getPortLabel } from "@/hooks/usePortLabels";
import { useExtensions } from "@/hooks/useExtensions";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";

export const CallAutoSmsPanel = () => {
  const { data: config, isLoading } = useCallAutoSmsConfig();
  const { data: portLabels } = usePortLabels();
  const { extensions } = useExtensions();
  const updateConfig = useUpdateCallAutoSmsConfig();

  const [enabled, setEnabled] = useState(false);
  const [answeredMessage, setAnsweredMessage] = useState(
    "Thank you for calling us! We appreciate your business and are here to help anytime."
  );
  const [missedMessage, setMissedMessage] = useState(
    "We missed your call! Sorry we couldn't answer. We'll get back to you shortly. Your call is important to us."
  );
  const [delayEnabled, setDelayEnabled] = useState(true);
  const [delayMinutes, setDelayMinutes] = useState(5);
  const [allowedPorts, setAllowedPorts] = useState<number[]>([]);
  const [allowedExtensions, setAllowedExtensions] = useState<string[]>([]);
  const [callDirection, setCallDirection] = useState<'both' | 'inbound' | 'outbound'>('both');

  useEffect(() => {
    if (config) {
      setEnabled(!!config.enabled);
      setAnsweredMessage(config.answered_message);
      setMissedMessage(config.missed_message);
      setDelayEnabled(config.delay_enabled !== false);
      setDelayMinutes(config.delay_minutes || 5);
      setAllowedPorts(config.allowed_ports || []);
      setAllowedExtensions(config.allowed_extensions || []);
      setCallDirection((config.call_direction as 'both' | 'inbound' | 'outbound') || 'both');
    }
  }, [config]);

  const handleSave = () => {
    updateConfig.mutate(
      { 
        enabled, 
        answered_message: answeredMessage, 
        missed_message: missedMessage,
        delay_enabled: delayEnabled,
        delay_minutes: delayMinutes,
        allowed_ports: allowedPorts,
        allowed_extensions: allowedExtensions,
        call_direction: callDirection
      },
      {
        onSuccess: () => toast.success("Call Auto-SMS settings saved"),
        onError: (err) => toast.error(err.message),
      }
    );
  };

  const togglePort = (portNumber: number) => {
    setAllowedPorts(prev =>
      prev.includes(portNumber)
        ? prev.filter(p => p !== portNumber)
        : [...prev, portNumber].sort()
    );
  };

  const availablePorts = portLabels ? Object.values(portLabels) : [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <Label className="text-muted-foreground font-medium">Call Auto-SMS</Label>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="call-autosms-enabled" className="text-xs text-muted-foreground">
              {enabled ? "Active" : "Inactive"}
            </Label>
            <Switch
              id="call-autosms-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateConfig.isPending}
            className="gap-1.5"
          >
            {updateConfig.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Automatically send SMS to callers after each call. Different messages are sent based on whether the call was answered or missed, helping build client trust and engagement.
      </p>

      <div className="p-3 rounded-lg bg-accent/30 border border-accent/50">
        <p className="text-xs font-medium text-accent-foreground mb-1">Available Template Variables</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { var: "{caller_name}", desc: "Caller name or number" },
            { var: "{caller_number}", desc: "Phone number" },
            { var: "{time}", desc: "Call time" },
            { var: "{date}", desc: "Call date" },
            { var: "{duration}", desc: "Call duration" },
            { var: "{extension}", desc: "PBX extension" },
          ].map((v) => (
            <code
              key={v.var}
              className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground cursor-default"
              title={v.desc}
            >
              {v.var}
            </code>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="p-4 rounded-lg bg-muted/30 border border-border/30 space-y-2">
          <div className="flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-green-500" />
            <Label className="text-sm font-medium">Answered Call SMS</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Sent when a call is successfully answered — a thank-you follow-up.
          </p>
          <Textarea
            value={answeredMessage}
            onChange={(e) => setAnsweredMessage(e.target.value)}
            placeholder="Thank you for calling..."
            className="min-h-[100px] text-sm bg-background/50"
            maxLength={500}
          />
          <span className="text-[10px] text-muted-foreground">{answeredMessage.length}/500</span>
        </div>

        <div className="p-4 rounded-lg bg-muted/30 border border-border/30 space-y-2">
          <div className="flex items-center gap-2">
            <PhoneMissed className="w-4 h-4 text-destructive" />
            <Label className="text-sm font-medium">Missed Call SMS</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Sent when a call is missed — reassures the client you'll follow up.
          </p>
          <Textarea
            value={missedMessage}
            onChange={(e) => setMissedMessage(e.target.value)}
            placeholder="We missed your call..."
            className="min-h-[100px] text-sm bg-background/50"
            maxLength={500}
          />
          <span className="text-[10px] text-muted-foreground">{missedMessage.length}/500</span>
        </div>
      </div>

      {/* Delay Configuration */}
      <div className="p-4 rounded-lg bg-muted/30 border border-border/30 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-4 h-4 text-blue-500" />
          <Label className="text-sm font-medium">Delayed SMS (Anti-Duplicate)</Label>
        </div>
        
        <p className="text-xs text-muted-foreground">
          Send SMS after a delay to prevent duplicates if the caller calls back. For example, if a caller calls and disconnects, we help prevent sending both "missed" and "answered" messages to the same number within a short time span.
        </p>

        <div className="space-y-3 p-3 bg-background/50 rounded border border-border/20">
          <div className="flex items-center justify-between">
            <Label htmlFor="delay-enabled" className="text-sm cursor-pointer">
              Enable Delay
            </Label>
            <Switch
              id="delay-enabled"
              checked={delayEnabled}
              onCheckedChange={setDelayEnabled}
            />
          </div>

          {delayEnabled && (
            <div className="space-y-2 pt-2 border-t border-border/20">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Delay Time: {delayMinutes} minute{delayMinutes !== 1 ? 's' : ''}</Label>
              </div>
              <Slider
                value={[delayMinutes]}
                onValueChange={(value) => setDelayMinutes(value[0])}
                min={0}
                max={60}
                step={1}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                {delayMinutes === 0 
                  ? "Send immediately (no duplicate protection)" 
                  : `SMS will be sent ${delayMinutes} minute${delayMinutes !== 1 ? 's' : ''} after the call`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Port Selection */}
      <div className="p-4 rounded-lg bg-muted/30 border border-border/30 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Smartphone className="w-4 h-4 text-purple-500" />
          <Label className="text-sm font-medium">SIM Port Restrictions</Label>
        </div>

        <p className="text-xs text-muted-foreground">
          Select which SIM ports are allowed to send auto-SMS. Leave empty to send for all ports.
        </p>

        <div className="space-y-2 p-3 bg-background/50 rounded border border-border/20">
          {availablePorts.length > 0 ? (
            <div className="space-y-2">
              {availablePorts.map((portInfo) => (
                <div key={portInfo.port_number} className="flex items-center gap-2">
                  <Checkbox
                    id={`port-${portInfo.port_number}`}
                    checked={allowedPorts.includes(portInfo.port_number)}
                    onCheckedChange={() => togglePort(portInfo.port_number)}
                    disabled={!portInfo.enabled}
                  />
                  <Label 
                    htmlFor={`port-${portInfo.port_number}`} 
                    className={`text-sm cursor-pointer ${!portInfo.enabled ? 'text-muted-foreground line-through' : ''}`}
                  >
                    {getPortLabel(portInfo.port_number, portLabels)}
                    {!portInfo.enabled && ' (Disabled)'}
                  </Label>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No ports configured</p>
          )}
          {allowedPorts.length === 0 && availablePorts.length > 0 && (
            <p className="text-xs text-blue-600 pt-2 border-t border-border/20">
              ℹ️ All ports will send SMS (none restricted)
            </p>
          )}
        </div>
      </div>

      {/* Call Direction */}
      <div className="p-4 rounded-lg bg-muted/30 border border-border/30 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <ArrowLeftRight className="w-4 h-4 text-orange-500" />
          <Label className="text-sm font-medium">Call Direction</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Choose which call directions trigger auto-SMS. Defaults to both.
        </p>
        <div className="flex gap-2">
          {([
            { value: 'both',     icon: ArrowLeftRight, label: 'Both' },
            { value: 'inbound',  icon: ArrowDownLeft,  label: 'Inbound' },
            { value: 'outbound', icon: ArrowUpRight,   label: 'Outbound' },
          ] as { value: 'both' | 'inbound' | 'outbound'; icon: React.ElementType; label: string }[]).map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setCallDirection(value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                callDirection === value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
        {callDirection === 'outbound' && (
          <p className="text-xs text-amber-600">
            ⚠️ Outbound mode sends SMS to the external number your agent called.
          </p>
        )}
      </div>

      {/* Extension Filter */}
      <div className="p-4 rounded-lg bg-muted/30 border border-border/30 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-4 h-4 text-teal-500" />
          <Label className="text-sm font-medium">Extension Filter</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Select which extensions trigger auto-SMS. Leave all unchecked to apply to every extension.
        </p>
        <div className="space-y-2 p-3 bg-background/50 rounded border border-border/20">
          {extensions.length > 0 ? (
            <div className="space-y-2">
              {extensions.map((ext) => (
                <div key={ext.extnumber} className="flex items-center gap-2">
                  <Checkbox
                    id={`ext-${ext.extnumber}`}
                    checked={allowedExtensions.includes(ext.extnumber)}
                    onCheckedChange={() =>
                      setAllowedExtensions(prev =>
                        prev.includes(ext.extnumber)
                          ? prev.filter(e => e !== ext.extnumber)
                          : [...prev, ext.extnumber].sort()
                      )
                    }
                  />
                  <Label htmlFor={`ext-${ext.extnumber}`} className="text-sm cursor-pointer">
                    {ext.extnumber}{ext.username ? ` — ${ext.username}` : ''}
                  </Label>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No extensions found</p>
          )}
          {allowedExtensions.length === 0 && extensions.length > 0 && (
            <p className="text-xs text-blue-600 pt-2 border-t border-border/20">
              ℹ️ All extensions will trigger auto-SMS (none restricted)
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
