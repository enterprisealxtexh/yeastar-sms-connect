import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TelegramMessage {
  chat_id: string;
  text: string;
  parse_mode?: string;
}

async function sendTelegram(botToken: string, msg: TelegramMessage) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error [${res.status}]: ${body}`);
  }
  return res.json();
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

    if (!TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    }
    if (!TELEGRAM_CHAT_ID) {
      throw new Error("TELEGRAM_CHAT_ID is not configured");
    }

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action } = await req.json();
    console.log(`Telegram notify action: ${action}`);

    let messageText = "";

    if (action === "system_summary") {
      // Fetch all data for a full summary
      const [smsRes, callsRes, logsRes, simRes, gwRes, pbxRes] = await Promise.all([
        supabase.from("sms_messages").select("*").order("received_at", { ascending: false }).limit(10),
        supabase.from("call_records").select("*").order("start_time", { ascending: false }).limit(10),
        supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(10),
        supabase.from("sim_port_config").select("*").order("port_number"),
        supabase.from("gateway_config").select("*").limit(1),
        supabase.from("pbx_config").select("*").limit(1),
      ]);

      const activeSims = (simRes.data || []).filter((s: any) => s.enabled).length;
      const totalSims = (simRes.data || []).length;
      const gwIp = gwRes.data?.[0]?.gateway_ip || "N/A";
      const pbxIp = pbxRes.data?.[0]?.pbx_ip || "N/A";

      messageText = `📊 *SYSTEM SUMMARY*\n\n`;
      messageText += `🔧 *Gateway:* ${escapeMarkdown(gwIp)}\n`;
      messageText += `📞 *PBX:* ${escapeMarkdown(pbxIp)}\n`;
      messageText += `📡 *SIMs:* ${activeSims}/${totalSims} active\n\n`;

      // Recent SMS
      messageText += `💬 *Recent SMS \\(${(smsRes.data || []).length}\\):*\n`;
      for (const sms of (smsRes.data || []).slice(0, 5)) {
        const from = escapeMarkdown(sms.sender_number || "Unknown");
        const msg = escapeMarkdown((sms.message_content || "").substring(0, 50));
        const cat = escapeMarkdown(sms.category || "unknown");
        messageText += `  • SIM${sms.sim_port} ← ${from}: ${msg} \\[${cat}\\]\n`;
      }

      // Recent Calls
      messageText += `\n📞 *Recent Calls \\(${(callsRes.data || []).length}\\):*\n`;
      for (const call of (callsRes.data || []).slice(0, 5)) {
        const dir = call.direction === "inbound" ? "⬇️" : call.direction === "outbound" ? "⬆️" : "↔️";
        const caller = escapeMarkdown(call.caller_number || "Unknown");
        const callee = escapeMarkdown(call.callee_number || "Unknown");
        const status = escapeMarkdown(call.status || "unknown");
        const dur = call.total_duration ? `${call.total_duration}s` : "N/A";
        messageText += `  ${dir} ${caller} → ${callee} \\[${status}, ${escapeMarkdown(dur)}\\]\n`;
      }

      // Recent Logs
      messageText += `\n📋 *Recent Logs \\(${(logsRes.data || []).length}\\):*\n`;
      for (const log of (logsRes.data || []).slice(0, 5)) {
        const sev = log.severity === "error" ? "🔴" : log.severity === "warning" ? "🟡" : log.severity === "success" ? "🟢" : "🔵";
        const msg = escapeMarkdown((log.message || "").substring(0, 60));
        messageText += `  ${sev} ${msg}\n`;
      }

    } else if (action === "sms_logs") {
      const { data: smsData } = await supabase
        .from("sms_messages")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(20);

      messageText = `💬 *SMS LOG REPORT*\n\n`;
      messageText += `Total fetched: ${(smsData || []).length}\n\n`;
      for (const sms of smsData || []) {
        const from = escapeMarkdown(sms.sender_number);
        const msg = escapeMarkdown((sms.message_content || "").substring(0, 80));
        const cat = escapeMarkdown(sms.category || "unknown");
        const time = escapeMarkdown(new Date(sms.received_at).toLocaleString());
        messageText += `📱 SIM${sms.sim_port} ← *${from}*\n  ${msg}\n  _${cat} \\| ${time}_\n\n`;
      }
      if (!(smsData || []).length) messageText += `_No SMS messages found_`;

    } else if (action === "call_logs") {
      const { data: callData } = await supabase
        .from("call_records")
        .select("*")
        .order("start_time", { ascending: false })
        .limit(20);

      messageText = `📞 *CALL LOG REPORT*\n\n`;
      messageText += `Total fetched: ${(callData || []).length}\n\n`;
      for (const call of callData || []) {
        const dir = call.direction === "inbound" ? "⬇️ IN" : call.direction === "outbound" ? "⬆️ OUT" : "↔️ INT";
        const caller = escapeMarkdown(call.caller_number);
        const callee = escapeMarkdown(call.callee_number);
        const status = escapeMarkdown(call.status);
        const dur = call.total_duration ? `${call.total_duration}s` : "N/A";
        const time = escapeMarkdown(new Date(call.start_time).toLocaleString());
        messageText += `${dir} *${caller}* → *${callee}*\n  Status: ${status} \\| Duration: ${escapeMarkdown(dur)}\n  _${time}_\n\n`;
      }
      if (!(callData || []).length) messageText += `_No call records found_`;

    } else if (action === "activity_logs") {
      const { data: logData } = await supabase
        .from("activity_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      messageText = `📋 *ACTIVITY LOG REPORT*\n\n`;
      messageText += `Total fetched: ${(logData || []).length}\n\n`;
      for (const log of logData || []) {
        const sev = log.severity === "error" ? "🔴" : log.severity === "warning" ? "🟡" : log.severity === "success" ? "🟢" : "🔵";
        const msg = escapeMarkdown(log.message);
        const type = escapeMarkdown(log.event_type);
        const time = escapeMarkdown(new Date(log.created_at).toLocaleString());
        messageText += `${sev} *${type}*\n  ${msg}\n  _${time}_\n\n`;
      }
      if (!(logData || []).length) messageText += `_No activity logs found_`;

    } else if (action === "gateway_status") {
      const [gwRes, pbxRes, simRes] = await Promise.all([
        supabase.from("gateway_config").select("*").limit(1),
        supabase.from("pbx_config").select("*").limit(1),
        supabase.from("sim_port_config").select("*").order("port_number"),
      ]);

      const gw = gwRes.data?.[0];
      const pbx = pbxRes.data?.[0];
      const sims = simRes.data || [];

      messageText = `🔧 *GATEWAY & PBX STATUS*\n\n`;
      messageText += `*Gateway:*\n`;
      messageText += `  IP: ${escapeMarkdown(gw?.gateway_ip || "Not configured")}\n`;
      messageText += `  User: ${escapeMarkdown(gw?.api_username || "N/A")}\n\n`;
      messageText += `*PBX:*\n`;
      messageText += `  IP: ${escapeMarkdown(pbx?.pbx_ip || "Not configured")}\n`;
      messageText += `  Port: ${pbx?.pbx_port || "N/A"}\n`;
      messageText += `  Web Port: ${pbx?.web_port || "N/A"}\n\n`;

      messageText += `*SIM Ports:*\n`;
      for (const sim of sims) {
        const status = sim.enabled ? "✅" : "❌";
        const num = escapeMarkdown(sim.phone_number || "No number");
        const carrier = escapeMarkdown(sim.carrier || "Unknown");
        const signal = sim.signal_strength != null ? `${sim.signal_strength}%` : "N/A";
        messageText += `  ${status} Port ${sim.port_number}: ${num} \\(${carrier}\\) Signal: ${escapeMarkdown(signal)}\n`;
      }

    } else if (action === "error_logs") {
      const { data: errorData } = await supabase
        .from("error_logs")
        .select("*")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(20);

      messageText = `🚨 *UNRESOLVED ERROR REPORT*\n\n`;
      messageText += `Count: ${(errorData || []).length}\n\n`;
      for (const err of errorData || []) {
        const type = escapeMarkdown(err.error_type);
        const msg = escapeMarkdown((err.error_message || "").substring(0, 100));
        const time = escapeMarkdown(new Date(err.created_at).toLocaleString());
        const diagnosis = err.ai_diagnosis ? `\n  💡 ${escapeMarkdown(err.ai_diagnosis.substring(0, 80))}` : "";
        messageText += `🔴 *${type}*\n  ${msg}${diagnosis}\n  _${time}_\n\n`;
      }
      if (!(errorData || []).length) messageText += `✅ _No unresolved errors_`;

    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    // Split long messages (Telegram limit is 4096 chars)
    const chunks: string[] = [];
    if (messageText.length <= 4096) {
      chunks.push(messageText);
    } else {
      let remaining = messageText;
      while (remaining.length > 0) {
        if (remaining.length <= 4096) {
          chunks.push(remaining);
          break;
        }
        let splitIdx = remaining.lastIndexOf("\n", 4096);
        if (splitIdx <= 0) splitIdx = 4096;
        chunks.push(remaining.substring(0, splitIdx));
        remaining = remaining.substring(splitIdx);
      }
    }

    for (const chunk of chunks) {
      await sendTelegram(TELEGRAM_BOT_TOKEN, {
        chat_id: TELEGRAM_CHAT_ID,
        text: chunk,
        parse_mode: "MarkdownV2",
      });
    }

    console.log(`Telegram message sent successfully for action: ${action}`);
    return new Response(
      JSON.stringify({ success: true, action, chunks: chunks.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Telegram notify error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
