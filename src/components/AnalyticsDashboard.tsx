import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import { BarChart3, PieChartIcon, Clock, TrendingUp, MessageSquare, Zap, Phone, X } from "lucide-react";
import { useAnalytics } from "@/hooks/useAnalytics";
import { usePortLabels, getPortLabel } from "@/hooks/usePortLabels";
import { useExtensions } from "@/hooks/useExtensions";
import { useAuth } from "@/hooks/useAuth";
import { useUserPermissions } from "@/hooks/useUserPermissions";

const COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))"];

interface AnalyticsDashboardProps {
  dateFrom?: Date;
  dateTo?: Date;
  onDateChange?: (from: Date | undefined, to: Date | undefined) => void;
}

export const AnalyticsDashboard = ({ dateFrom: initialDateFrom, dateTo: initialDateTo, onDateChange }: AnalyticsDashboardProps) => {
  const [dateFrom, setDateFrom] = useState<Date | undefined>(initialDateFrom);
  const [dateTo, setDateTo] = useState<Date | undefined>(initialDateTo);
  const { data: analytics, isLoading } = useAnalytics(7, dateFrom, dateTo);
  const { data: portLabels } = usePortLabels();
  const { getUsername } = useExtensions();
  const { role } = useAuth();
  const { data: permissions } = useUserPermissions();
  const isViewer = role === "viewer";
  const viewerPorts = permissions?.ports ?? [];
  const viewerExtensions = permissions?.extensions ?? [];

  const visibleExtensionBreakdown = useMemo(() => {
    const all = analytics?.extensionBreakdown ?? [];
    if (isViewer && viewerExtensions.length > 0) return all.filter(e => viewerExtensions.includes(e.extension));
    return all;
  }, [analytics?.extensionBreakdown, isViewer, viewerExtensions]);

  const visiblePortActivity = useMemo(() => {
    const all = analytics?.portActivity ?? [];
    if (isViewer && viewerPorts.length > 0) return all.filter(p => viewerPorts.includes(p.port));
    return all;
  }, [analytics?.portActivity, isViewer, viewerPorts]);

  const combinedDailyData = useMemo(() => {
    if (!analytics) return [];
    const callsMap = new Map((analytics.dailyCalls ?? []).map(d => [d.date, d.count]));
    return analytics.dailyMessages.map(d => ({
      date: d.date,
      sms: d.count,
      calls: callsMap.get(d.date) ?? 0,
    }));
  }, [analytics]);

  const combinedHourlyData = useMemo(() => {
    if (!analytics) return [];
    const callsMap = new Map((analytics.hourlyCalls ?? []).map(d => [d.hour, d.count]));
    return analytics.hourlyDistribution.map(d => ({
      hour: d.hour,
      sms: d.count,
      calls: callsMap.get(d.hour) ?? 0,
    }));
  }, [analytics]);

  const handleResetDates = () => {
    setDateFrom(undefined);
    setDateTo(undefined);
    onDateChange?.(undefined, undefined);
  };

  const handleSetPreset = (days: number) => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    
    setDateFrom(start);
    setDateTo(end);
    onDateChange?.(start, end);
  };

  useEffect(() => {
    if (initialDateFrom !== undefined || initialDateTo !== undefined) {
      setDateFrom(initialDateFrom);
      setDateTo(initialDateTo);
    }
  }, [initialDateFrom, initialDateTo]);

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[200px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (!analytics) return null;

  const formatHour = (hour: number) => {
    if (hour === 0) return "12am";
    if (hour === 12) return "12pm";
    return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
  };

  const formatDuration = (seconds: number) => {
    if (seconds === 0) return "0s";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const getExtensionUsername = (extension: string, fallback?: string) => {
    const fromPbx = getUsername(extension);
    if (fromPbx && fromPbx.trim()) return fromPbx;
    if (fallback && fallback.trim() && fallback !== extension) return fallback;
    return "";
  };

  return (
    <div className="space-y-6">
      {/* Date Range Filter */}
      <Card className="border-border/50 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold mb-4">Filter by Date Range (Africa/Nairobi Time)</CardTitle>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">From:</label>
              <Input 
                type="date" 
                value={dateFrom ? dateFrom.toISOString().split('T')[0] : ''} 
                onChange={(e) => {
                  const date = e.target.value ? new Date(e.target.value + 'T00:00:00') : undefined;
                  setDateFrom(date);
                }} 
                className="w-[150px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">To:</label>
              <Input 
                type="date" 
                value={dateTo ? dateTo.toISOString().split('T')[0] : ''} 
                onChange={(e) => {
                  const date = e.target.value ? new Date(e.target.value + 'T00:00:00') : undefined;
                  setDateTo(date);
                }} 
                className="w-[150px]"
              />
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => handleSetPreset(7)}>7 Days</Button>
              <Button size="sm" variant="outline" onClick={() => handleSetPreset(30)}>30 Days</Button>
              <Button size="sm" variant="outline" onClick={() => handleSetPreset(90)}>90 Days</Button>
            </div>
            {(dateFrom || dateTo) && (
              <Button size="sm" variant="destructive" onClick={handleResetDates} className="ml-auto gap-1">
                <X className="w-3 h-3" /> Reset
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Messages & Calls */}
        <Card className="card-glow border-border/50 bg-card">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                <MessageSquare className="w-4 h-4 text-primary" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Volume</p>
              <p className="text-[10px] text-muted-foreground/50 ml-auto">{dateFrom && dateTo ? `${dateFrom.toLocaleDateString()} – ${dateTo.toLocaleDateString()}` : '7 days'}</p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Messages</span>
                <span className="text-sm font-bold tabular-nums">{analytics.totalMessages}</span>
              </div>
              <div className="h-px bg-border/40" />
              <div className="flex items-center justify-between">
                <span className="text-sm text-chart-2">Calls</span>
                <span className="text-sm font-bold tabular-nums text-chart-2">{analytics.totalCalls}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Avg per day */}
        <Card className="card-glow border-border/50 bg-card">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-chart-2/10">
                <TrendingUp className="w-4 h-4 text-chart-2" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Avg / Day</p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Messages</span>
                <span className="text-sm font-bold tabular-nums">{analytics.averagePerDay.toFixed(1)}</span>
              </div>
              <div className="h-px bg-border/40" />
              <div className="flex items-center justify-between">
                <span className="text-sm text-chart-2">Calls</span>
                <span className="text-sm font-bold tabular-nums text-chart-2">{analytics.callsAveragePerDay.toFixed(1)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Busiest SIM */}
        <Card className="card-glow border-border/50 bg-card">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-chart-3/10">
                <Zap className="w-4 h-4 text-chart-3" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Busiest SIM</p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Messages</span>
                <span className="text-sm font-bold tabular-nums">{analytics.busiestPort ? getPortLabel(analytics.busiestPort, portLabels) : "N/A"}</span>
              </div>
              <div className="h-px bg-border/40" />
              <div className="flex items-center justify-between">
                <span className="text-sm text-chart-2">Calls</span>
                <span className="text-sm font-bold tabular-nums text-chart-2">{analytics.callsBusiestPort ? getPortLabel(analytics.callsBusiestPort, portLabels) : "N/A"}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Peak hour */}
        <Card className="card-glow border-border/50 bg-card">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-chart-4/10">
                <Clock className="w-4 h-4 text-chart-4" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Peak Hour</p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Messages</span>
                <span className="text-sm font-bold tabular-nums">{analytics.peakHour !== null ? formatHour(analytics.peakHour) : "N/A"}</span>
              </div>
              <div className="h-px bg-border/40" />
              <div className="flex items-center justify-between">
                <span className="text-sm text-chart-2">Calls</span>
                <span className="text-sm font-bold tabular-nums text-chart-2">{analytics.callsPeakHour !== null ? formatHour(analytics.callsPeakHour) : "N/A"}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Daily Messages & Calls Chart */}
        <Card className="card-glow border-border/50 bg-card">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                <BarChart3 className="w-4 h-4 text-primary" />
              </div>
              <CardTitle className="text-sm font-semibold">Messages & Calls per Day</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={combinedDailyData}>
                  <defs>
                    <linearGradient id="colorSms" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value, name) => [value, name === "sms" ? "SMS" : "Calls"]}
                  />
                  <Legend formatter={(value) => value === "sms" ? "SMS" : "Calls"} />
                  <Area
                    type="monotone"
                    dataKey="sms"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#colorSms)"
                  />
                  <Area
                    type="monotone"
                    dataKey="calls"
                    stroke="hsl(var(--chart-2))"
                    strokeWidth={2}
                    fill="url(#colorCalls)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Port Activity Chart */}
        <Card className="card-glow border-border/50 bg-card">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-chart-2/10">
                <PieChartIcon className="w-4 h-4 text-chart-2" />
              </div>
              <CardTitle className="text-sm font-semibold">Messages by SIM Port</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] flex items-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={visiblePortActivity}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="count"
                    nameKey="port"
                    label={({ port, count }) => (count > 0 ? `P${port}` : "")}
                    labelLine={false}
                  >
                    {visiblePortActivity.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value, name) => {
                      const portNumber = Number(name);
                      const label = Number.isFinite(portNumber)
                        ? getPortLabel(portNumber, portLabels)
                        : `Port ${name}`;
                      return [`${value} messages`, label];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 ml-4">
                {visiblePortActivity.map((item, index) => (
                  <div key={item.port} className="flex items-center gap-2 text-xs">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    <span className="text-white font-medium">{getPortLabel(item.port, portLabels)}:</span>
                    <span className="font-mono font-bold text-white">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hourly Distribution */}
      <Card className="card-glow border-border/50 bg-card">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-chart-3/10">
              <Clock className="w-4 h-4 text-chart-3" />
            </div>
            <CardTitle className="text-sm font-semibold">Hourly Distribution (SMS & Calls)</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={combinedHourlyData}>
                <XAxis
                  dataKey="hour"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(hour) => (hour % 3 === 0 ? formatHour(hour) : "")}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value, name) => [`${value}`, name === "sms" ? "SMS" : "Calls"]}
                  labelFormatter={(hour) => formatHour(hour)}
                />
                <Legend formatter={(value) => value === "sms" ? "SMS" : "Calls"} />
                <Bar dataKey="sms" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="calls" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      {/* Per-Extension Breakdown */}
      {visibleExtensionBreakdown.length > 0 && (
        <Card className="card-glow border-border/50 bg-card">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-chart-4/10">
                <Phone className="w-4 h-4 text-chart-4" />
              </div>
              <CardTitle className="text-sm font-semibold">Per-Extension Breakdown{dateFrom && dateTo ? ` (${dateFrom.toLocaleDateString()} - ${dateTo.toLocaleDateString()})` : ' (7 days)'}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Extension</TableHead>
                  <TableHead>Port</TableHead>
                  <TableHead className="text-center">Calls</TableHead>
                  <TableHead className="text-center">Answered</TableHead>
                  <TableHead className="text-center">Missed</TableHead>
                   <TableHead className="text-center">Called Back</TableHead>
                   <TableHead className="text-center">SMS</TableHead>
                   <TableHead className="text-center">Total Talk</TableHead>
                   <TableHead className="text-center">Avg Talk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleExtensionBreakdown.map((ext) => (
                  <TableRow key={ext.extension}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col leading-tight">
                        <span>{ext.extension}</span>
                        {getExtensionUsername(ext.extension, ext.label) && (
                          <span className="text-xs text-muted-foreground">
                            {getExtensionUsername(ext.extension, ext.label)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col leading-tight">
                        <Badge variant="outline" className="font-mono text-xs w-fit">P{ext.port}</Badge>
                        {ext.port > 0 && (
                          <span className="text-xs text-muted-foreground mt-1">
                            {getPortLabel(ext.port, portLabels)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-mono">{ext.totalCalls}</TableCell>
                    <TableCell className="text-center font-mono text-chart-2">{ext.answeredCalls}</TableCell>
                    <TableCell className="text-center font-mono text-destructive">{ext.missedCalls}</TableCell>
                    <TableCell className="text-center">
                      <span className="font-mono">{ext.calledBack}</span>
                      {ext.missedCalls > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({Math.round((ext.calledBack / ext.missedCalls) * 100)}%)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono">{ext.smsCount}</TableCell>
                    <TableCell className="text-center font-mono text-muted-foreground">{formatDuration(ext.totalTalkTime)}</TableCell>
                    <TableCell className="text-center font-mono text-muted-foreground">{formatDuration(ext.avgTalkTime)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
