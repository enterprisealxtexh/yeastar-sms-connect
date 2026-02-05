import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Database configuration missing' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch gateway config from database
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: config, error: configError } = await supabase
      .from('gateway_config')
      .select('*')
      .limit(1)
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ success: false, error: 'Gateway configuration not found in database' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { gateway_ip, api_username, api_password } = config;

    if (!gateway_ip || !api_username || !api_password) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Gateway credentials incomplete',
          details: {
            hasIp: !!gateway_ip,
            hasUsername: !!api_username,
            hasPassword: !!api_password,
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Test Connection] Testing gateway at ${gateway_ip}`);

    const authHeader = btoa(`${api_username}:${api_password}`);
    const startTime = Date.now();

    // Try to connect to the TG400 gateway
    // The Yeastar TG400 typically has a status endpoint
    const endpoints = [
      `/api/v1.0/system/status`,
      `/api/v1.0/sms/get?port=1`,
      `/cgi-bin/api-get_status`,
      `/api/status`,
    ];

    let connectionSuccess = false;
    let responseTime = 0;
    let gatewayInfo: Record<string, unknown> = {};
    let lastError = '';

    for (const endpoint of endpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const response = await fetch(`http://${gateway_ip}${endpoint}`, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        responseTime = Date.now() - startTime;

        if (response.ok) {
          connectionSuccess = true;
          try {
            const data = await response.json();
            gatewayInfo = {
              endpoint,
              status: response.status,
              ...data,
            };
          } catch {
            gatewayInfo = {
              endpoint,
              status: response.status,
              message: 'Connected successfully',
            };
          }
          console.log(`[Test Connection] Success on endpoint: ${endpoint}`);
          break;
        } else if (response.status === 401) {
          lastError = 'Authentication failed - check username/password';
        } else if (response.status === 403) {
          lastError = 'Access forbidden - API access may be disabled';
        } else {
          lastError = `HTTP ${response.status}`;
        }
      } catch (fetchError) {
        if (fetchError instanceof Error) {
          if (fetchError.name === 'AbortError') {
            lastError = 'Connection timed out';
          } else {
            lastError = fetchError.message;
          }
        }
        console.log(`[Test Connection] Endpoint ${endpoint} failed: ${lastError}`);
      }
    }

    // Log the test result
    await supabase.from('activity_logs').insert({
      event_type: 'connection_test',
      message: connectionSuccess 
        ? `Gateway connection test successful (${responseTime}ms)` 
        : `Gateway connection test failed: ${lastError}`,
      severity: connectionSuccess ? 'success' : 'error',
      metadata: { gateway_ip, responseTime, success: connectionSuccess },
    });

    if (connectionSuccess) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Gateway connection successful',
          responseTime,
          gateway: gateway_ip,
          info: gatewayInfo,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          error: lastError || 'Could not connect to gateway',
          gateway: gateway_ip,
          responseTime,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Test Connection] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
