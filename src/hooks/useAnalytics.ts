import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/integrations/supabase/api-client";
import { startOfDay, subDays, format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

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
  smsCount: number;
  callCount: number;
}

interface CallStatusDistribution {
  status: "answered" | "missed" | "busy" | "failed";
  count: number;
}

interface DailyCallCount {
  date: string;
  count: number;
}

export interface AnalyticsData {
  // SMS Analytics
  dailyMessages: DailyMessageCount[];
  portActivity: PortActivity[];
  hourlyDistribution: HourlyDistribution[];
  totalMessages: number;
  averageMessagesPerDay: number;
  busiestPort: number | null;
  
  // Call Analytics
  dailyCalls: DailyCallCount[];
  callStatusDistribution: CallStatusDistribution[];
  totalCalls: number;
  averageCallsPerDay: number;
  totalCallDuration: number;
  
  // Peak metrics
  peakHour: number | null;
}

export const useAnalytics = (days: number = 7, extensionFilter?: string, portFilter?: number) => {
  return useQuery({
    queryKey: ["analytics", days, extensionFilter, portFilter],
    queryFn: async (): Promise<AnalyticsData> => {
      const apiUrl = import.meta.env.VITE_API_URL;
      const timeZone = 'Africa/Nairobi';

      // Helper to parse database timestamps (format: "YYYY-MM-DD HH:MM:SS" stored as UTC)
      const parseDBTimestamp = (dateStr: string): Date => {
        // Parse "2026-02-16 13:00:00" as UTC by appending Z
        const isoStr = dateStr.replace(' ', 'T') + 'Z';
        return new Date(isoStr);
      };

      // Calculate start date - get start of day in Nairobi timezone
      const nowInNairobi = toZonedTime(new Date(), timeZone);
      const startDateInNairobi = startOfDay(subDays(nowInNairobi, days - 1));
      
      // Convert Nairobi date to UTC for database query
      // If it's Feb 18, 2026 00:00:00 in Nairobi (UTC+3), that's Feb 17, 2026 21:00:00 UTC
      const startUTC = new Date(startDateInNairobi.getTime() - (3 * 60 * 60 * 1000));
      
      // Format as ISO string for SMS query - stored as "YYYY-MM-DDTHH:MM:SS.000Z" in database
      const startDateISO = startUTC.toISOString();
      
      // Format as "YYYY-MM-DD HH:MM:SS" for call records database query
      const startDateStr = startUTC.toISOString().replace('T', ' ').substring(0, 19);
      
      // Fetch SMS messages using ISO format (SMS dates are stored as ISO format in DB)
      const { data: messages, error: msgError } = await apiClient.getSmsMessages({
        since: startDateISO,
        limit: 10000,
      });

      // Fetch call records - get all historical data
      let calls: any[] = [];
      try {
        const callResponse = await fetch(`${apiUrl}/api/call-records?limit=10000`);
        if (callResponse.ok) {
          const callData = await callResponse.json();
          calls = (callData.data || []).filter((call: any) => {
            const callDate = parseDBTimestamp(call.start_time);
            return callDate >= startUTC;
          });
        }
      } catch (e) {
        console.warn('Failed to fetch call records:', e);
      }

      if (msgError) throw msgError;

      // Helper to get display date in Nairobi timezone (e.g., "Feb 16")
      const getDisplayDate = (dateObj: Date): string => {
        const nairobi = toZonedTime(dateObj, timeZone);
        const year = nairobi.getFullYear();
        const month = nairobi.getMonth();
        const date = nairobi.getDate();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[month]} ${date}`;
      };

      // Helper to get display hour in Nairobi timezone
      const getDisplayHour = (dateObj: Date): number => {
        const nairobi = toZonedTime(dateObj, timeZone);
        return nairobi.getHours();
      };

      // Process daily message counts (using Nairobi local time)
      const dailyMessageMap = new Map<string, number>();
      for (let i = 0; i < days; i++) {
        const dateInNairobi = subDays(nowInNairobi, days - 1 - i);
        const displayDate = getDisplayDate(dateInNairobi);
        dailyMessageMap.set(displayDate, 0);
      }

      // Process daily call counts (using Nairobi local time)
      const dailyCallMap = new Map<string, number>();
      for (let i = 0; i < days; i++) {
        const dateInNairobi = subDays(nowInNairobi, days - 1 - i);
        const displayDate = getDisplayDate(dateInNairobi);
        dailyCallMap.set(displayDate, 0);
      }

      // Process port activity
      const portMap = new Map<number, number>();
      [1, 2, 3, 4].forEach((port) => portMap.set(port, 0));

      // Process hourly distribution for both SMS and calls
      const hourlyMap = new Map<number, { smsCount: number; callCount: number }>();
      for (let i = 0; i < 24; i++) {
        hourlyMap.set(i, { smsCount: 0, callCount: 0 });
      }

      // Process call status distribution
      const callStatusMap = new Map<string, number>();
      ['answered', 'missed', 'busy', 'failed'].forEach((status) => callStatusMap.set(status, 0));

      // Count SMS messages (using Nairobi local time for grouping)
      // SMS is NEVER filtered by extension - always show all SMS data
      (messages || []).forEach((msg) => {
        const msgDate = parseDBTimestamp(msg.received_at);
        const displayDate = getDisplayDate(msgDate);
        const hour = getDisplayHour(msgDate);
        const port = msg.sim_port;

        // Apply port filter if specified
        if (portFilter !== undefined && port !== portFilter) {
          return;
        }

        if (dailyMessageMap.has(displayDate)) {
          dailyMessageMap.set(displayDate, (dailyMessageMap.get(displayDate) || 0) + 1);
        }
        portMap.set(port, (portMap.get(port) || 0) + 1);
        
        const hourData = hourlyMap.get(hour) || { smsCount: 0, callCount: 0 };
        hourlyMap.set(hour, { ...hourData, smsCount: hourData.smsCount + 1 });
      });

      // Count call records (using Nairobi local time for grouping)
      // Calls ARE filtered by extension when specified
      let filteredCalls = calls;
      if (extensionFilter && extensionFilter !== "all") {
        filteredCalls = calls.filter((call) => {
          // Match extension directly
          return call.extension === extensionFilter;
        });
      }

      filteredCalls.forEach((call) => {
        const callDate = parseDBTimestamp(call.start_time);
        const displayDate = getDisplayDate(callDate);
        const hour = getDisplayHour(callDate);
        const status = call.status || 'unknown';

        if (dailyCallMap.has(displayDate)) {
          dailyCallMap.set(displayDate, (dailyCallMap.get(displayDate) || 0) + 1);
        }

        const hourData = hourlyMap.get(hour) || { smsCount: 0, callCount: 0 };
        hourlyMap.set(hour, { ...hourData, callCount: hourData.callCount + 1 });

        if (callStatusMap.has(status)) {
          callStatusMap.set(status, (callStatusMap.get(status) || 0) + 1);
        }
      });

      const dailyMessages: DailyMessageCount[] = Array.from(dailyMessageMap.entries()).map(
        ([date, count]) => ({ date, count })
      );

      const dailyCalls: DailyCallCount[] = Array.from(dailyCallMap.entries()).map(
        ([date, count]) => ({ date, count })
      );

      const portActivity: PortActivity[] = Array.from(portMap.entries())
        .map(([port, count]) => ({ port, count }))
        .sort((a, b) => a.port - b.port);

      const hourlyDistribution: HourlyDistribution[] = Array.from(hourlyMap.entries())
        .map(([hour, counts]) => ({ hour, ...counts }))
        .sort((a, b) => a.hour - b.hour);

      const callStatusDistribution: CallStatusDistribution[] = Array.from(callStatusMap.entries())
        .map(([status, count]) => ({ status: status as any, count }))
        .filter(item => item.count > 0)
        .sort((a, b) => b.count - a.count);

      const totalMessages = messages?.length || 0;
      const averageMessagesPerDay = totalMessages / days;
      const totalCalls = filteredCalls.length;
      const averageCallsPerDay = totalCalls / days;
      const totalCallDuration = filteredCalls.reduce((sum, call) => sum + (call.total_duration || 0), 0);

      const busiestPort =
        portActivity.length > 0
          ? portActivity.reduce((max, p) => (p.count > max.count ? p : max)).port
          : null;

      const combinedHourly = hourlyDistribution.map(h => h.smsCount + h.callCount);
      const peakHour =
        combinedHourly.length > 0
          ? hourlyDistribution[combinedHourly.indexOf(Math.max(...combinedHourly))].hour
          : null;

      return {
        dailyMessages,
        dailyCalls,
        portActivity,
        hourlyDistribution,
        callStatusDistribution,
        totalMessages,
        averageMessagesPerDay,
        totalCalls,
        averageCallsPerDay,
        totalCallDuration,
        busiestPort,
        peakHour,
      };
    },
    refetchInterval: 180000, // Refetch every 3 minutes - expensive computation
    staleTime: 120000, // 2 minute stale time
    retry: 1,
  });
};
