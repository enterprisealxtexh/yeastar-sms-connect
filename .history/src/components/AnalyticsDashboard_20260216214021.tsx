import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { BarChart3, PieChartIcon, Clock, TrendingUp, MessageSquare, Phone, Zap } from "lucide-react";
import { useAnalytics } from "@/hooks/useAnalytics";

const COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))"];
const CALL_COLORS = {
  answered: "hsl(var(--chart-1))",
  missed: "hsl(var(--destructive))",
  busy: "hsl(var(--chart-2))",
  failed: "hsl(var(--chart-3))",
  voicemail: "hsl(var(--chart-4))",
};

export const AnalyticsDashboard = () => {
  const { data: analytics, isLoading } = useAnalytics(7);

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

  return (
    <div className="space-y-6">
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
                    <p className="text-xs text-muted-foreground">Messages (7 days)</p>
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
                    <p className="text-xs text-muted-foreground">Calls (7 days)</p>
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
                  <AreaChart data={analytics.hourlyDistribution}>
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
                    />
                    <Area
                      type="monotone"
                      dataKey="callCount"
                      name="Calls"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#colorCalls)"
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
                    <AreaChart data={analytics.dailyMessages}>
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
                    <AreaChart data={analytics.dailyCalls}>
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
