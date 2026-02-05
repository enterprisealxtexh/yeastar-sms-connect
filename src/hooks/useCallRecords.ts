import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export interface CallRecord {
  id: string;
  external_id: string | null;
  caller_number: string;
  callee_number: string;
  caller_name: string | null;
  callee_name: string | null;
  direction: "inbound" | "outbound" | "internal";
  status: "answered" | "missed" | "busy" | "failed" | "voicemail";
  sim_port: number | null;
  extension: string | null;
  start_time: string;
  answer_time: string | null;
  end_time: string | null;
  ring_duration: number;
  talk_duration: number;
  hold_duration: number;
  total_duration: number;
  recording_url: string | null;
  transfer_to: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const useCallRecords = () => {
  const query = useQuery({
    queryKey: ["call-records"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_records")
        .select("*")
        .order("start_time", { ascending: false })
        .limit(200);

      if (error) throw error;
      return data as CallRecord[];
    },
    refetchInterval: 30000,
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("call-records-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_records" },
        () => {
          query.refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [query]);

  return query;
};

export const useCallStats = () => {
  return useQuery({
    queryKey: ["call-stats"],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from("call_records")
        .select("status, talk_duration, ring_duration")
        .gte("start_time", today.toISOString());

      if (error) throw error;

      const stats = {
        totalCalls: data.length,
        answered: data.filter((c) => c.status === "answered").length,
        missed: data.filter((c) => c.status === "missed").length,
        avgTalkDuration: 0,
        avgRingDuration: 0,
      };

      const answeredCalls = data.filter((c) => c.status === "answered");
      if (answeredCalls.length > 0) {
        stats.avgTalkDuration = Math.round(
          answeredCalls.reduce((sum, c) => sum + (c.talk_duration || 0), 0) /
            answeredCalls.length
        );
        stats.avgRingDuration = Math.round(
          answeredCalls.reduce((sum, c) => sum + (c.ring_duration || 0), 0) /
            answeredCalls.length
        );
      }

      return stats;
    },
    refetchInterval: 30000,
  });
};
