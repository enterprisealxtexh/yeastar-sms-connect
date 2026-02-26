import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  LineChart,
  Line,
} from "recharts";
import { BarChart3, PieChartIcon, Clock, TrendingUp, MessageSquare, Phone, Zap, Download } from "lucide-react";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { useExtensions } from "@/hooks/useExtensions";
import { usePortLabels } from "@/hooks/usePortLabels";
import { toast } from "sonner";

const COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))"];
const CALL_COLORS = {
  answered: "hsl(var(--chart-1))",
  missed: "hsl(var(--destructive))",
  busy: "hsl(var(--chart-2))",
  failed: "hsl(var(--chart-3))",
  voicemail: "hsl(var(--chart-4))",
};

type TimePeriod = "day" | "week" | "month" | "year";

const timePeriodDays: Record<TimePeriod, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

const timePeriodLabels: Record<TimePeriod, string> = {
  day: "Last 24 Hours",
  week: "Last 7 Days",
  month: "Last 30 Days",
  year: "Last Year",
};

export const AnalyticsDashboard = () => {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("week");
  const [extensionFilter, setExtensionFilter] = useState<string>("all");
  const [portFilter, setPortFilter] = useState<number | undefined>(undefined);
  
  const { data: analytics, isLoading } = useAnalytics(
    timePeriodDays[timePeriod],
    extensionFilter === "all" ? undefined : extensionFilter,
    portFilter
  );
  const auth = useAuth();
  const { extensions } = useExtensions();
  const { data: portLabels = {} } = usePortLabels();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[150px] rounded-lg" />
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
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  // Export SMS Report as CSV
  const exportSmsReport = () => {
    if (!analytics) return;
    
    const headers = ["Date", "Count"];
    const rows = analytics.dailyMessages.map((day) => [day.date, day.count.toString()]);
    
    const csvContent = [
      ["SMS Analytics Report", timePeriodLabels[timePeriod]],
      [],
      ["Summary"],
      ["Total Messages", analytics.totalMessages.toString()],
      ["Average per day", analytics.averageMessagesPerDay.toFixed(2)],
      ["Busiest Port", `Port ${analytics.busiestPort || "N/A"}`],
      [],
      ["Daily Breakdown"],
      headers,
      ...rows,
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sms-report-${timePeriod}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("SMS report exported");
  };

  // Export Call Report as CSV
  const exportCallReport = () => {
    if (!analytics) return;
    
    const headers = ["Date", "Call Count"];
    const rows = analytics.dailyCalls.map((day) => [day.date, day.count.toString()]);
    
    const statusBreakdown = analytics.callStatusDistribution
      .map((s) => [s.status.charAt(0).toUpperCase() + s.status.slice(1), s.count.toString()]);

    const csvContent = [
      ["Call Analytics Report", timePeriodLabels[timePeriod]],
      [],
      ["Summary"],
      ["Total Calls", analytics.totalCalls.toString()],
      ["Average per day", analytics.averageCallsPerDay.toFixed(2)],
      ["Total Duration", formatDuration(analytics.totalCallDuration)],
      [],
      ["Call Status Breakdown"],
      ["Status", "Count"],
      ...statusBreakdown,
      [],
      ["Daily Breakdown"],
      headers,
      ...rows,
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `call-report-${timePeriod}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Call report exported");
  };

  return (
    <div className="space-y-6">
      {/* Time Period Selector and Export Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex gap-2">
            {(["day", "week", "month", "year"] as const).map((period) => (
              <Button
                key={period}
                variant={timePeriod === period ? "default" : "outline"}
                size="sm"
                onClick={() => setTimePeriod(period)}
                className="capitalize"
              >
                {period === "day"
                  ? "24h"
                  : period === "week"
                    ? "7d"
                    : period === "month"
                      ? "30d"
                      : "1y"}
              </Button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <Select value={extensionFilter} onValueChange={setExtensionFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Extension" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Extensions</SelectItem>
                {extensions.map((ext) => (
                  <SelectItem key={ext.extnumber} value={ext.extnumber}>
                    {ext.extnumber} - {ext.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select 
              value={portFilter?.toString() || "all"} 
              onValueChange={(val) => setPortFilter(val === "all" ? undefined : parseInt(val))}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="SIM Port" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Ports</SelectItem>
                {[1, 2, 3, 4].map((port) => (
                  <SelectItem key={port} value={port.toString()}>
                    {portLabels[port]?.label || `Port ${port}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Export Controls - Admin Only */}
        {auth?.user?.role === "admin" && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportSmsReport}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export SMS</span>
              <span className="inline sm:hidden">SMS</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCallReport}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export Calls</span>
              <span className="inline sm:hidden">Calls</span>
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-card border border-border/50">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sms">SMS Analytics</TabsTrigger>
          <TabsTrigger value="calls">Call Analytics</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Combined Summary Stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="card-glow border-border/50 bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                    <MessageSquare className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{analytics.totalMessages}</p>
                    <p className="text-xs text-muted-foreground">Messages ({timePeriodLabels[timePeriod]})</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-glow border-border/50 bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-chart-1/10">
                    <Phone className="w-5 h-5 text-chart-1" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{analytics.totalCalls}</p>
                    <p className="text-xs text-muted-foreground">Calls ({timePeriodLabels[timePeriod]})</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-glow border-border/50 bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-chart-2/10">
                    <TrendingUp className="w-5 h-5 text-chart-2" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {formatDuration(analytics.totalCallDuration)}
                    </p>
                    <p className="text-xs text-muted-foreground">Total call time</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-glow border-border/50 bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-chart-3/10">
                    <Clock className="w-5 h-5 text-chart-3" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {analytics.peakHour !== null ? formatHour(analytics.peakHour) : "N/A"}
                    </p>
                    <p className="text-xs text-muted-foreground">Peak hour</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Combined Hourly Chart */}
          <Card className="card-glow border-border/50 bg-card">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-chart-3/10">
                  <Clock className="w-4 h-4 text-chart-3" />
                </div>
                <CardTitle className="text-sm font-semibold">Activity by Hour (SMS + Calls)</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.hourlyDistribution} isAnimationActive={true} animationDuration={500}>
                    <defs>
                      <linearGradient id="colorSms" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="hour"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(hour) => (hour % 3 === 0 ? formatHour(hour) : "")}
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
                    />
                    <Area
                      type="monotone"
                      dataKey="smsCount"
                      name="SMS"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#colorSms)"
                      isAnimationActive={true}
                      animationDuration={500}
                    />
                    <Area
                      type="monotone"
                      dataKey="callCount"
                      name="Calls"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#colorCalls)"
                      isAnimationActive={true}
                      animationDuration={500}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SMS Tab */}
        <TabsContent value="sms" className="space-y-6">
          {/* SMS Summary Stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="card-glow border-border/50 bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                    <MessageSquare className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{analytics.totalMessages}</p>
                    <p className="text-xs text-muted-foreground">Total Messages</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-glow border-border/50 bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-chart-2/10">
                    <TrendingUp className="w-5 h-5 text-chart-2" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{analytics.averageMessagesPerDay.toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">Avg per day</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-glow border-border/50 bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-chart-3/10">
                    <Zap className="w-5 h-5 text-chart-3" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {analytics.busiestPort ? `Port ${analytics.busiestPort}` : "N/A"}
                    </p>
                    <p className="text-xs text-muted-foreground">Busiest SIM</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* SMS Charts Row */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Daily Messages Chart */}
            <Card className="card-glow border-border/50 bg-card">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                    <BarChart3 className="w-4 h-4 text-primary" />
                  </div>
                  <CardTitle className="text-sm font-semibold">Messages per Day</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analytics.dailyMessages} isAnimationActive={true} animationDuration={500}>
                      <defs>
                        <linearGradient id="colorMessages" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
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
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#colorMessages)"
                        isAnimationActive={true}
                        animationDuration={500}
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
                        data={analytics.portActivity}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="count"
                        nameKey="port"
                        label={({ port, count }) => (count > 0 ? `P${port}` : "")}
                        labelLine={false}
                        isAnimationActive={true}
                        animationDuration={500}
                      >
                        {analytics.portActivity.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                        formatter={(value, name) => [`${value} messages`, `Port ${name}`]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 ml-4">
                    {analytics.portActivity.map((item, index) => (
                      <div key={item.port} className="flex items-center gap-2 text-xs">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="text-muted-foreground">Port {item.port}:</span>
                        <span className="font-mono font-medium">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Calls Tab */}
        <TabsContent value="calls" className="space-y-6">
          {/* Calls Summary Stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="card-glow border-border/50 bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-chart-1/10">
                    <Phone className="w-5 h-5 text-chart-1" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{analytics.totalCalls}</p>
                    <p className="text-xs text-muted-foreground">Total Calls</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-glow border-border/50 bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-chart-2/10">
                    <TrendingUp className="w-5 h-5 text-chart-2" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{analytics.averageCallsPerDay.toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">Avg per day</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-glow border-border/50 bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-chart-3/10">
                    <Clock className="w-5 h-5 text-chart-3" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {formatDuration(analytics.totalCallDuration)}
                    </p>
                    <p className="text-xs text-muted-foreground">Total duration</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Call Charts Row */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Daily Calls Chart */}
            <Card className="card-glow border-border/50 bg-card">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-chart-1/10">
                    <BarChart3 className="w-4 h-4 text-chart-1" />
                  </div>
                  <CardTitle className="text-sm font-semibold">Calls per Day</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analytics.dailyCalls} isAnimationActive={true} animationDuration={500}>
                      <defs>
                        <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
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
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="url(#colorCalls)"
                        isAnimationActive={true}
                        animationDuration={500}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Call Status Distribution */}
            <Card className="card-glow border-border/50 bg-card">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-chart-2/10">
                    <PieChartIcon className="w-4 h-4 text-chart-2" />
                  </div>
                  <CardTitle className="text-sm font-semibold">Calls by Status</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[200px] flex items-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analytics.callStatusDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="count"
                        nameKey="status"
                        label={({ status, count }) => (count > 0 ? status[0].toUpperCase() : "")}
                        labelLine={false}
                        isAnimationActive={true}
                        animationDuration={500}
                      >
                        {analytics.callStatusDistribution.map((item) => (
                          <Cell key={`cell-${item.status}`} fill={CALL_COLORS[item.status]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                        formatter={(value, name) => [`${value} calls`, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 ml-4">
                    {analytics.callStatusDistribution.map((item) => (
                      <div key={item.status} className="flex items-center gap-2 text-xs">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: CALL_COLORS[item.status] }}
                        />
                        <span className="text-muted-foreground capitalize">{item.status}:</span>
                        <span className="font-mono font-medium">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
