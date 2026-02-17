import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, Copy, Check, Terminal, Zap, Settings, HelpCircle, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useGatewayConfig } from "@/hooks/useGatewayConfig";

export const LocalAgentGuide = () => {
  const [copied, setCopied] = useState<string | null>(null);
  const { config } = useGatewayConfig();

  const copyCommand = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(null), 2000);
  };

  // Get the actual gateway config or use defaults
  const gatewayIp = config?.gateway_ip || "192.168.5.3";
  const apiUsername = config?.api_username || "NOSTEQ";
  const apiPort = config?.api_port || 5038;

  const installCommand = `curl -fsSL https://id-preview--02b61bbc-2d1a-4cc5-b544-9f855adac829.lovable.app/local-agent/install.sh | sudo bash`;
  const testCommand = `curl -u ${apiUsername}:password http://${gatewayIp}:${apiPort}/api/v1.0/system/status`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Server className="h-4 w-4" />
          Local Agent Setup
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Local Polling Agent Setup
          </DialogTitle>
          <DialogDescription>
            One-command installation for Ubuntu servers (20.04 - 25.04)
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <Tabs defaultValue="quick" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="quick" className="gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              Quick Install
            </TabsTrigger>
            <TabsTrigger value="commands" className="gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              Commands
            </TabsTrigger>
            <TabsTrigger value="help" className="gap-1.5">
              <HelpCircle className="h-3.5 w-3.5" />
              Troubleshooting
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[450px] mt-4">
            {/* Quick Install Tab */}
            <TabsContent value="quick" className="space-y-6 pr-4">
              {/* Configuration Status */}
              <section className="p-3 rounded-lg border bg-card">
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Badge variant="outline">Current Configuration</Badge>
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <span className="text-muted-foreground">Gateway IP:</span>
                    <code className="font-mono font-semibold">{gatewayIp}</code>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <span className="text-muted-foreground">API Port:</span>
                    <code className="font-mono font-semibold">{apiPort}</code>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <span className="text-muted-foreground">Username:</span>
                    <code className="font-mono font-semibold">{apiUsername}</code>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <span className="text-muted-foreground">Status:</span>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-green-600 text-xs font-semibold">Configured</span>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <Badge variant="outline">Why?</Badge>
                </h3>
                <p className="text-sm text-muted-foreground">
                  Your TG400 gateway is on a private network that cloud services cannot reach.
                  This agent runs locally and syncs SMS data to the cloud automatically.
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Badge variant="default">One-Line Install</Badge>
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Run this command on your Ubuntu server as root:
                </p>
                <div className="relative group">
                  <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto font-mono border">
                    {installCommand}
                  </pre>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copyCommand(installCommand, "install")}
                  >
                    {copied === "install" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Badge>After Installation</Badge>
                </h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</div>
                    <div>
                      <p className="font-medium text-sm">Configure your gateway</p>
                      <code className="text-xs text-muted-foreground">sudo tg400-config</code>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</div>
                    <div>
                      <p className="font-medium text-sm">Start the agent</p>
                      <code className="text-xs text-muted-foreground">sudo systemctl start tg400-agent</code>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">3</div>
                    <div>
                      <p className="font-medium text-sm">Check status</p>
                      <code className="text-xs text-muted-foreground">tg400-status</code>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <Badge variant="secondary">What Gets Installed</Badge>
                </h3>
                <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
                  <li>Node.js 20 LTS (automatically from NodeSource)</li>
                  <li>TG400 Agent in <code className="bg-muted px-1 rounded">/opt/tg400-agent/</code></li>
                  <li>Systemd service (auto-start on boot)</li>
                  <li>Helper commands for easy management</li>
                </ul>
              </section>
            </TabsContent>

            {/* Commands Tab */}
            <TabsContent value="commands" className="space-y-4 pr-4">
              <section>
                <h3 className="font-semibold text-sm mb-3">Management Commands</h3>
                <div className="space-y-2">
                  {[
                    { cmd: "sudo tg400-config", desc: "Interactive configuration wizard" },
                    { cmd: "tg400-status", desc: "Show agent status and recent logs" },
                    { cmd: "tg400-logs", desc: "Follow live logs (Ctrl+C to exit)" },
                    { cmd: "tg400-restart", desc: "Restart the agent" },
                    { cmd: "tg400-test", desc: "Test gateway & cloud connection" },
                  ].map(({ cmd, desc }) => (
                    <div key={cmd} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                      <div>
                        <code className="text-sm font-mono text-primary">{cmd}</code>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyCommand(cmd, cmd)}
                      >
                        {copied === cmd ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-3">Service Control</h3>
                <div className="space-y-2">
                  {[
                    { cmd: "sudo systemctl start tg400-agent", desc: "Start the agent" },
                    { cmd: "sudo systemctl stop tg400-agent", desc: "Stop the agent" },
                    { cmd: "sudo systemctl restart tg400-agent", desc: "Restart the agent" },
                    { cmd: "sudo systemctl status tg400-agent", desc: "Check service status" },
                  ].map(({ cmd, desc }) => (
                    <div key={cmd} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                      <div>
                        <code className="text-xs font-mono">{cmd}</code>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyCommand(cmd, cmd)}
                      >
                        {copied === cmd ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-3">Log Commands</h3>
                <div className="space-y-2">
                  {[
                    { cmd: "journalctl -u tg400-agent -f", desc: "Follow live logs" },
                    { cmd: "journalctl -u tg400-agent -n 100", desc: "Last 100 log lines" },
                    { cmd: "journalctl -u tg400-agent --since '1 hour ago'", desc: "Logs from last hour" },
                  ].map(({ cmd, desc }) => (
                    <div key={cmd} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                      <div>
                        <code className="text-xs font-mono">{cmd}</code>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyCommand(cmd, cmd)}
                      >
                        {copied === cmd ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            </TabsContent>

            {/* Troubleshooting Tab */}
            <TabsContent value="help" className="space-y-5 pr-4">
              <section>
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <Badge variant="destructive">Cannot connect to gateway</Badge>
                </h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Configured gateway: <code className="bg-muted px-1 rounded text-xs font-mono">{gatewayIp}:{apiPort}</code></p>
                  <p>1. Verify the gateway IP is reachable:</p>
                  <code className="block bg-muted p-2 rounded text-xs font-mono">ping {gatewayIp}</code>
                  <p>2. Test API access manually:</p>
                  <code className="block bg-muted p-2 rounded text-xs font-mono">{testCommand}</code>
                  <p>3. Check if web interface is accessible in a browser</p>
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <Badge variant="destructive">Agent not starting</Badge>
                </h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Check detailed logs:</p>
                  <code className="block bg-muted p-2 rounded text-xs font-mono">journalctl -u tg400-agent -n 50</code>
                  <p>Test manually:</p>
                  <code className="block bg-muted p-2 rounded text-xs font-mono">cd /opt/tg400-agent && node agent.js --test</code>
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <Badge variant="destructive">Authentication failed (401)</Badge>
                </h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Username/password don't match the TG400 web interface.</p>
                  <p>Re-run configuration:</p>
                  <code className="block bg-muted p-2 rounded text-xs font-mono">sudo tg400-config</code>
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <Badge variant="destructive">No messages syncing</Badge>
                </h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>The agent tries multiple API endpoints. Possible causes:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>TG400 firmware version may use different API endpoints</li>
                    <li>No new SMS messages in the gateway inbox</li>
                    <li>SIM port numbers configured incorrectly</li>
                  </ul>
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <Badge variant="secondary">Uninstall</Badge>
                </h3>
                <pre className="text-xs bg-muted p-3 rounded font-mono overflow-x-auto">
{`sudo systemctl stop tg400-agent
sudo systemctl disable tg400-agent
sudo rm /etc/systemd/system/tg400-agent.service
sudo rm -rf /opt/tg400-agent
sudo rm /usr/local/bin/tg400-*
sudo systemctl daemon-reload`}
                </pre>
              </section>
            </TabsContent>
          </ScrollArea>
        </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};