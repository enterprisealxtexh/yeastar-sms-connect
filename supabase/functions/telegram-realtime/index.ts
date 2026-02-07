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

function esc(text: string): string {
  return (text || "").replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function formatSms(record: Record<string, unknown>): string {
  const port = record.sim_port ?? "?";
  const from = esc(String(record.sender_number || "Unknown"));
  const content = esc(String(record.message_content || "").substring(0, 200));
  const category = esc(String(record.category || "unknown"));
  const time = esc(new Date(String(record.received_at || record.created_at)).toLocaleString());

  return (
    `📱 *NEW SMS RECEIVED*\n\n` +
    `*From:* ${from}\n` +
    `*SIM Port:* ${port}\n` +
    `*Category:* ${category}\n` +
    `*Time:* ${time}\n\n` +
    `💬 ${content}`
  );
}

function formatCall(record: Record<string, unknown>): string {
  const dir = record.direction === "inbound" ? "⬇️ INCOMING" : record.direction === "outbound" ? "⬆️ OUTGOING" : "↔️ INTERNAL";
  const caller = esc(String(record.caller_number || "Unknown"));
  const callerName = record.caller_name ? ` \\(${esc(String(record.caller_name))}\\)` : "";
  const callee = esc(String(record.callee_number || "Unknown"));
  const calleeName = record.callee_name ? ` \\(${esc(String(record.callee_name))}\\)` : "";
  const status = esc(String(record.status || "unknown"));
  const ext = record.extension ? esc(String(record.extension)) : "N/A";
  const port = record.sim_port != null ? String(record.sim_port) : "N/A";
  const duration = record.total_duration ? `${record.total_duration}s` : "N/A";
  const time = esc(new Date(String(record.start_time || record.created_at)).toLocaleString());

  return (
    `📞 *NEW CALL ${dir}*\n\n` +
    `*Caller:* ${caller}${callerName}\n` +
    `*Callee:* ${callee}${calleeName}\n` +
    `*Status:* ${status}\n` +
    `*Extension:* ${ext}\n` +
    `*SIM Port:* ${port}\n` +
    `*Duration:* ${esc(duration)}\n` +
    `*Time:* ${time}`
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

    if (!TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    if (!TELEGRAM_CHAT_ID) throw new Error("TELEGRAM_CHAT_ID is not configured");

    const body = await req.json();
    const { type, record } = body;

    console.log(`Telegram realtime alert: type=${type}, id=${record?.id}`);

    if (!type || !record) {
      throw new Error("Missing 'type' or 'record' in request body");
    }

    let messageText: string;
    if (type === "sms") {
      messageText = formatSms(record);
    } else if (type === "call") {
      messageText = formatCall(record);
    } else {
      throw new Error(`Unknown type: ${type}`);
    }

    await sendTelegram(TELEGRAM_BOT_TOKEN, {
      chat_id: TELEGRAM_CHAT_ID,
      text: messageText,
      parse_mode: "MarkdownV2",
    });

    console.log(`Telegram realtime alert sent for ${type} id=${record.id}`);
    return new Response(
      JSON.stringify({ success: true, type }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Telegram realtime error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
