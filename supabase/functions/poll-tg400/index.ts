import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SmsMessage {
  id: string;
  sender: string;
  content: string;
  receivedAt: string;
  simPort: number;
  status: 'unread' | 'read' | 'processed';
}

interface TG400Response {
  status: string;
  messages?: Array<{
    id: string;
    from: string;
    text: string;
    time: string;
    port: number;
  }>;
  error?: string;
}

// Yeastar TG400 API interaction
async function fetchSmsFromTG400(
  gatewayIp: string,
  username: string,
  password: string,
  simPort: number
): Promise<SmsMessage[]> {
  console.log(`[TG400] Polling SIM port ${simPort} at ${gatewayIp}`);
  
  try {
    // Yeastar TG400 uses HTTP API for SMS retrieval
    // The exact endpoint varies by firmware version, common patterns:
    // - /api/sms/inbox
    // - /cgi-bin/api-sms
    // - /api/v1.0/sms/get
    
    const authHeader = btoa(`${username}:${password}`);
    
    // Try the common Yeastar API endpoint for SMS
    const response = await fetch(`http://${gatewayIp}/api/v1.0/sms/get?port=${simPort}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[TG400] Port ${simPort} returned status ${response.status}`);
      
      // If the standard endpoint fails, try alternative endpoints
      const altResponse = await fetch(`http://${gatewayIp}/cgi-bin/api-get_sms?port=${simPort}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${authHeader}`,
        },
      });
      
      if (!altResponse.ok) {
        const errorText = await altResponse.text();
        console.error(`[TG400] Alternative endpoint also failed: ${errorText}`);
        return [];
      }
      
      const altData = await altResponse.json();
      return parseMessages(altData, simPort);
    }

    const data: TG400Response = await response.json();
    console.log(`[TG400] Port ${simPort} response:`, JSON.stringify(data).substring(0, 200));
    
    return parseMessages(data, simPort);
  } catch (error) {
    console.error(`[TG400] Error polling port ${simPort}:`, error);
    return [];
  }
}

function parseMessages(data: any, simPort: number): SmsMessage[] {
  const messages: SmsMessage[] = [];
  
  // Handle various TG400 response formats
  const rawMessages = data.messages || data.sms || data.inbox || [];
  
  for (const msg of rawMessages) {
    messages.push({
      id: msg.id || msg.msgid || `${simPort}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sender: msg.from || msg.sender || msg.number || 'Unknown',
      content: msg.text || msg.content || msg.message || '',
      receivedAt: msg.time || msg.timestamp || msg.date || new Date().toISOString(),
      simPort: simPort,
      status: 'unread',
    });
  }
  
  return messages;
}

// Mark messages as processed on the TG400 to prevent duplicates
async function markAsProcessed(
  gatewayIp: string,
  username: string,
  password: string,
  messageIds: string[],
  simPort: number
): Promise<boolean> {
  if (messageIds.length === 0) return true;
  
  console.log(`[TG400] Marking ${messageIds.length} messages as processed on port ${simPort}`);
  
  try {
    const authHeader = btoa(`${username}:${password}`);
    
    const response = await fetch(`http://${gatewayIp}/api/v1.0/sms/delete`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        port: simPort,
        ids: messageIds,
      }),
    });

    if (!response.ok) {
      console.error(`[TG400] Failed to mark messages as processed`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`[TG400] Error marking messages as processed:`, error);
    return false;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const gatewayIp = Deno.env.get('TG400_GATEWAY_IP');
    const apiUsername = Deno.env.get('TG400_API_USERNAME');
    const apiPassword = Deno.env.get('TG400_API_PASSWORD');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!gatewayIp || !apiUsername || !apiPassword) {
      console.error('[TG400] Missing gateway credentials');
      return new Response(
        JSON.stringify({ 
          error: 'TG400 credentials not configured',
          missing: {
            ip: !gatewayIp,
            username: !apiUsername,
            password: !apiPassword,
          }
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[TG400] Starting poll cycle for gateway at ${gatewayIp}`);

    // Poll all 4 SIM ports in parallel
    const SIM_PORTS = [1, 2, 3, 4];
    const pollResults = await Promise.allSettled(
      SIM_PORTS.map(port => fetchSmsFromTG400(gatewayIp, apiUsername, apiPassword, port))
    );

    const allMessages: SmsMessage[] = [];
    const portStatus: Record<number, { success: boolean; messageCount: number; error?: string }> = {};

    pollResults.forEach((result, index) => {
      const port = SIM_PORTS[index];
      if (result.status === 'fulfilled') {
        allMessages.push(...result.value);
        portStatus[port] = { success: true, messageCount: result.value.length };
        console.log(`[TG400] Port ${port}: Retrieved ${result.value.length} messages`);
      } else {
        portStatus[port] = { success: false, messageCount: 0, error: result.reason?.message };
        console.error(`[TG400] Port ${port}: Failed - ${result.reason}`);
      }
    });

    // If we have Supabase configured, store the messages
    let storedCount = 0;
    if (supabaseUrl && supabaseKey && allMessages.length > 0) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      // Note: This requires the sms_messages table to exist
      // The table should be created via migration before using this function
      try {
        const { data, error } = await supabase
          .from('sms_messages')
          .upsert(
            allMessages.map(msg => ({
              external_id: msg.id,
              sender_number: msg.sender,
              message_content: msg.content,
              received_at: msg.receivedAt,
              sim_port: msg.simPort,
              status: msg.status,
            })),
            { onConflict: 'external_id' }
          );

        if (error) {
          console.error('[TG400] Database insert error:', error);
        } else {
          storedCount = allMessages.length;
          console.log(`[TG400] Stored ${storedCount} messages in database`);
          
          // Mark messages as processed on the gateway
          for (const port of SIM_PORTS) {
            const portMessages = allMessages.filter(m => m.simPort === port);
            if (portMessages.length > 0) {
              await markAsProcessed(
                gatewayIp, 
                apiUsername, 
                apiPassword, 
                portMessages.map(m => m.id),
                port
              );
            }
          }
        }
      } catch (dbError) {
        console.error('[TG400] Database operation failed:', dbError);
      }
    }

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      gateway: gatewayIp,
      summary: {
        totalMessages: allMessages.length,
        storedMessages: storedCount,
        portsPolled: SIM_PORTS.length,
      },
      portStatus,
      messages: allMessages,
    };

    console.log(`[TG400] Poll cycle complete: ${allMessages.length} messages retrieved`);

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[TG400] Unexpected error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
