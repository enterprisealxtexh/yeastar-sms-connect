import { useQuery } from "@tanstack/react-query";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

type SmsMessage = {
  sim_port?: number | string | null;
  received_at?: string | null;
};

type CallRecord = {
  extension?: string | null;
  caller_extension_username?: string | null;
  callee_extension_username?: string | null;
  sim_port?: number | string | null;
  status?: string | null;
  duration?: number | string | null;
  start_time?: string | null;
  is_returned?: number | boolean | null;
};

interface DailyMessageCount {
  date: string;
  count: number;
}

interface PortActivity {
  port: number;
  count: number;
}

interface HourlyDistribution {
  hour: number;
  count: number;
}

export interface ExtensionBreakdown {
  extension: string;
  label: string;
  port: number;
  totalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  calledBack: number;
  smsCount: number;
  totalTalkTime: number;
  avgTalkTime: number;
}

export interface AnalyticsData {
  dailyMessages: DailyMessageCount[];
  portActivity: PortActivity[];
  hourlyDistribution: HourlyDistribution[];
  totalMessages: number;
  averagePerDay: number;
  busiestPort: number | null;
  peakHour: number | null;
  extensionBreakdown: ExtensionBreakdown[];
}

export const useAnalytics = (days: number = 7, dateFrom?: Date, dateTo?: Date) => {
  return useQuery({
    queryKey: ["analytics", days, dateFrom?.toISOString(), dateTo?.toISOString()],
    queryFn: async (): Promise<AnalyticsData> => {
      const fallback: AnalyticsData = {
        dailyMessages: [],
        portActivity: [],
        hourlyDistribution: [],
        totalMessages: 0,
        averagePerDay: 0,
        busiestPort: null,
        peakHour: null,
        extensionBreakdown: [],
      };

      const [statsRes, smsRes, callsRes] = await Promise.all([
        fetch(`${API_URL}/api/statistics`),
        fetch(`${API_URL}/api/sms-messages?limit=2000`),
        fetch(`${API_URL}/api/call-records?limit=2000`),
      ]);

      if (!statsRes.ok) throw new Error("Failed to fetch analytics");

      const statsJson = await statsRes.json();
      const smsJson = smsRes.ok ? await smsRes.json() : { data: [] };
      const callsJson = callsRes.ok ? await callsRes.json() : { data: [] };

      const rawStats = statsJson?.data || {};
      const smsMessages: SmsMessage[] = Array.isArray(smsJson?.data) ? smsJson.data : [];
      const callRecords: CallRecord[] = Array.isArray(callsJson?.data) ? callsJson.data : [];

      // Convert dates to Africa/Nairobi timezone (UTC+3)
      const convertToNairobiDate = (date: Date): Date => {
        const formatter = new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          timeZone: 'Africa/Nairobi'
        });
        const parts = formatter.formatToParts(date);
        const nairobiDate = new Date(
          parseInt(parts.find(p => p.type === 'year')?.value || '2000'),
          parseInt(parts.find(p => p.type === 'month')?.value || '1') - 1,
          parseInt(parts.find(p => p.type === 'day')?.value || '1'),
          parseInt(parts.find(p => p.type === 'hour')?.value || '0'),
          parseInt(parts.find(p => p.type === 'minute')?.value || '0'),
          parseInt(parts.find(p => p.type === 'second')?.value || '0')
        );
        return nairobiDate;
      };

      // Determine start and end boundaries
      let startBoundary: Date;
      let endBoundary: Date;

      if (dateFrom && dateTo) {
        // Use provided date range: 00:00:00 to 23:59:59 in Nairobi time
        startBoundary = new Date(dateFrom);
        startBoundary.setHours(0, 0, 0, 0);
        
        endBoundary = new Date(dateTo);
        endBoundary.setHours(23, 59, 59, 999);
        
        // Calculate number of days for average calculation
        const dayDiff = Math.ceil((endBoundary.getTime() - startBoundary.getTime()) / (1000 * 60 * 60 * 24));
        days = Math.max(dayDiff, 1);
      } else {
        // Default: last 7 days
        startBoundary = new Date();
        startBoundary.setHours(0, 0, 0, 0);
        startBoundary.setDate(startBoundary.getDate() - (days - 1));
        
        endBoundary = new Date();
        endBoundary.setHours(23, 59, 59, 999);
      }

      const parseDate = (value: string | null | undefined) => {
        if (!value) return null;
        const direct = new Date(value);
        if (!Number.isNaN(direct.getTime())) return direct;
        const normalized = new Date(String(value).replace(" ", "T"));
        return Number.isNaN(normalized.getTime()) ? null : normalized;
      };

      const smsInRange = smsMessages.filter((msg) => {
        const date = parseDate(msg.received_at || undefined);
        return date ? date >= startBoundary && date <= endBoundary : false;
      });

      const dayKeys: string[] = [];
      const dayMap = new Map<string, number>();
      
      // Generate date keys for the selected range
      const currentDate = new Date(startBoundary);
      currentDate.setHours(0, 0, 0, 0);
      
      while (currentDate <= endBoundary) {
        const key = currentDate.toISOString().slice(0, 10);
        dayKeys.push(key);
        dayMap.set(key, 0);
        currentDate.setDate(currentDate.getDate() + 1);
      }

      const portMap = new Map<number, number>();
      const hourMap = new Map<number, number>();
      for (let h = 0; h < 24; h++) hourMap.set(h, 0);

      smsInRange.forEach((msg) => {
        const date = parseDate(msg.received_at || undefined);
        if (!date) return;
        const dayKey = date.toISOString().slice(0, 10);
        dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + 1);

        const port = Number(msg.sim_port);
        if (!Number.isNaN(port) && port > 0) {
          portMap.set(port, (portMap.get(port) || 0) + 1);
        }

        const hour = date.getHours();
        hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
      });

      const dailyMessages = dayKeys.map((key) => ({
        date: key,
        count: dayMap.get(key) || 0,
      }));

      const portActivity = Array.from(portMap.entries())
        .map(([port, count]) => ({ port, count }))
        .sort((a, b) => a.port - b.port);

      const hourlyDistribution = Array.from(hourMap.entries()).map(([hour, count]) => ({
        hour,
        count,
      }));

      const totalMessages = Number.isFinite(rawStats?.totalMessages)
        ? Number(rawStats.totalMessages)
        : smsInRange.length;
      const averagePerDay = days > 0 ? totalMessages / days : 0;
      const busiestPort = portActivity.length
        ? [...portActivity].sort((a, b) => b.count - a.count)[0].port
        : null;
      const peakHour = hourlyDistribution.length
        ? [...hourlyDistribution].sort((a, b) => b.count - a.count)[0].hour
        : null;

      const callsInRange = callRecords.filter((call) => {
        const date = parseDate(call.start_time || undefined);
        return date ? date >= startBoundary && date <= endBoundary : false;
      });

      const extMap = new Map<string, ExtensionBreakdown>();
      callsInRange.forEach((call) => {
        const extension = String(call.extension || "Unknown");
        const username =
          (typeof call.caller_extension_username === "string" && call.caller_extension_username.trim()) ||
          (typeof call.callee_extension_username === "string" && call.callee_extension_username.trim()) ||
          "";
        const port = Number(call.sim_port) || 0;
        const duration = Number(call.duration) || 0;
        const status = String(call.status || "").toLowerCase();
        const missed = status === "missed" || status === "no-answer" || status === "noanswer";
        const answered = status === "answered";
        const calledBack = Number(call.is_returned) === 1 || call.is_returned === true;

        if (!extMap.has(extension)) {
          extMap.set(extension, {
            extension,
            label: username,
            port,
            totalCalls: 0,
            answeredCalls: 0,
            missedCalls: 0,
            calledBack: 0,
            smsCount: 0,
            totalTalkTime: 0,
            avgTalkTime: 0,
          });
        }

        const current = extMap.get(extension)!;
        current.totalCalls += 1;
        if (answered) current.answeredCalls += 1;
        if (missed) current.missedCalls += 1;
        if (calledBack) current.calledBack += 1;
        current.totalTalkTime += duration;
        if (!current.port && port) current.port = port;
        if (!current.label && username) current.label = username;
      });

      // Approximate SMS per extension using extension's assigned SIM port.
      extMap.forEach((ext) => {
        if (!ext.port) return;
        ext.smsCount = smsInRange.filter((sms) => Number(sms.sim_port) === ext.port).length;
        ext.avgTalkTime = ext.answeredCalls > 0 ? Math.round(ext.totalTalkTime / ext.answeredCalls) : 0;
      });

      return {
        ...fallback,
        dailyMessages,
        portActivity,
        hourlyDistribution,
        totalMessages,
        averagePerDay,
        busiestPort,
        peakHour,
        extensionBreakdown: Array.from(extMap.values()).sort((a, b) => a.extension.localeCompare(b.extension)),
      };
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchInterval: 60000, // Refetch every minute
  });
};
