import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ErrorLog {
  id: string;
  error_type: string;
  error_message: string;
  error_context?: Record<string, unknown>;
  agent_id?: string;
  created_at: string;
}

interface DiagnosisResult {
  diagnosis: string;
  suggested_fix: string;
  auto_fixable: boolean;
  fix_action?: string;
}

interface PredictiveAlert {
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  prediction: string;
  recommended_action: string;
  auto_applied: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    // Authenticate the request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user has admin or operator role
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    const userRole = roleData?.role;
    if (!userRole || !['admin', 'operator'].includes(userRole)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Insufficient permissions' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { action, error_id, error_data, agent_version } = await req.json();

    // ========== DIAGNOSE ERRORS ==========
    if (action === 'diagnose') {
      let errorLog: ErrorLog;
      
      if (error_id) {
        const { data, error } = await supabase
          .from('error_logs')
          .select('*')
          .eq('id', error_id)
          .single();
        if (error) throw error;
        errorLog = data;
      } else if (error_data) {
        errorLog = error_data;
      } else {
        throw new Error('Either error_id or error_data required');
      }

      console.log(`[AI Diagnostics] Analyzing error: ${errorLog.error_type}`);
      const diagnosis = await diagnoseWithAI(errorLog, lovableApiKey);

      if (error_id) {
        await supabase
          .from('error_logs')
          .update({
            ai_diagnosis: diagnosis.diagnosis,
            ai_suggested_fix: diagnosis.suggested_fix,
          })
          .eq('id', error_id);
      }

      await supabase.from('activity_logs').insert({
        event_type: 'ai_diagnosis',
        message: `AI diagnosed error: ${errorLog.error_type}`,
        severity: 'info',
        metadata: { error_id, diagnosis: diagnosis.diagnosis, auto_fixable: diagnosis.auto_fixable },
      });

      return new Response(
        JSON.stringify({ success: true, diagnosis }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== SMART CONFIG OPTIMIZATION ==========
    if (action === 'tune_config') {
      const tuningResult = await tuneConfiguration(supabase, lovableApiKey);
      return new Response(
        JSON.stringify({ success: true, tuning: tuningResult }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== SMS CLASSIFICATION LEARNING ==========
    if (action === 'learn_categorization') {
      const learningResult = await learnFromFeedback(supabase, lovableApiKey);
      return new Response(
        JSON.stringify({ success: true, learning: learningResult }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== PREDICTIVE MAINTENANCE ==========
    if (action === 'predict_issues') {
      const prediction = await predictMaintenance(supabase, lovableApiKey);
      return new Response(
        JSON.stringify({ success: true, prediction }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== AUTO-CONFIGURE SIM PORTS ==========
    if (action === 'auto_configure_sims') {
      const result = await autoConfigureSims(supabase, lovableApiKey);
      return new Response(
        JSON.stringify({ success: true, result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== AUTO-CREATE CONTACTS ==========
    if (action === 'auto_create_contacts') {
      const result = await autoCreateContacts(supabase, lovableApiKey);
      return new Response(
        JSON.stringify({ success: true, result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== SUGGEST DASHBOARD ACTIONS ==========
    if (action === 'suggest_actions') {
      const result = await suggestDashboardActions(supabase, lovableApiKey);
      return new Response(
        JSON.stringify({ success: true, result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== RESOURCE OPTIMIZATION ==========
    if (action === 'resource_optimize') {
      const result = await optimizeResources(supabase, lovableApiKey);
      return new Response(
        JSON.stringify({ success: true, result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== AUTO-RUN ALL OPTIMIZATIONS ==========
    if (action === 'auto_optimize') {
      console.log('[AI Diagnostics] Running full auto-optimization cycle...');
      
      const results = {
        prediction: await predictMaintenance(supabase, lovableApiKey),
        tuning: await tuneConfiguration(supabase, lovableApiKey),
        learning: await learnFromFeedback(supabase, lovableApiKey),
        sim_config: await autoConfigureSims(supabase, lovableApiKey),
        contacts: await autoCreateContacts(supabase, lovableApiKey),
        actions: await suggestDashboardActions(supabase, lovableApiKey),
        resources: await optimizeResources(supabase, lovableApiKey),
      };

      await supabase.from('activity_logs').insert({
        event_type: 'ai_auto_optimize',
        message: 'AI completed full optimization cycle',
        severity: 'success',
        metadata: results,
      });

      return new Response(
        JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== APPLY RECOMMENDATION ==========
    if (action === 'apply_recommendation') {
      const { recommendation_id } = await req.json();
      const result = await applyRecommendation(supabase, recommendation_id);
      return new Response(
        JSON.stringify({ success: true, result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== AGENT VERSION UPDATES ==========
    if (action === 'check_updates') {
      const { data: latestUpdate } = await supabase
        .from('agent_updates')
        .select('*')
        .order('released_at', { ascending: false })
        .limit(1)
        .single();

      const updateAvailable = latestUpdate && agent_version && 
        compareVersions(latestUpdate.version, agent_version) > 0;

      return new Response(
        JSON.stringify({ 
          success: true, 
          latest_version: latestUpdate,
          update_available: updateAvailable,
          current_version: agent_version,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== PUBLISH NEW AGENT VERSION ==========
    if (action === 'publish_update') {
      const { version, release_notes, download_url, is_critical } = await req.json();
      
      const { data, error } = await supabase
        .from('agent_updates')
        .insert({
          version,
          release_notes,
          download_url,
          is_critical: is_critical || false,
          released_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      await supabase.from('activity_logs').insert({
        event_type: 'agent_update_published',
        message: `New agent version ${version} published`,
        severity: is_critical ? 'warning' : 'info',
        metadata: { version, is_critical },
      });

      return new Response(
        JSON.stringify({ success: true, update: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AI Diagnostics] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ========== HELPER FUNCTIONS ==========

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

// ========== AUTO-CONFIGURE SIM PORTS ==========
async function autoConfigureSims(supabase: ReturnType<typeof createClient>, apiKey?: string) {
  console.log('[AI] Running SIM auto-configuration...');
  
  const [portsResult, smsResult, callsResult, configResult] = await Promise.all([
    supabase.from('sim_port_config').select('*').order('port_number'),
    supabase.from('sms_messages').select('sim_port, sender_number').order('created_at', { ascending: false }).limit(200),
    supabase.from('call_records').select('sim_port, caller_number, callee_number, direction, status').order('created_at', { ascending: false }).limit(200),
    supabase.from('agent_config').select('*'),
  ]);

  const ports = portsResult.data || [];
  const smsMessages = smsResult.data || [];
  const calls = callsResult.data || [];
  const configs = configResult.data || [];
  const recommendations: Array<{ port: number; action: string; reason: string; details: Record<string, unknown> }> = [];

  // Analyze each port
  for (const port of ports) {
    const portSms = smsMessages.filter(s => s.sim_port === port.port_number);
    const portCalls = calls.filter(c => c.sim_port === port.port_number);
    const activity = portSms.length + portCalls.length;

    // Detect active but unconfigured ports
    if (activity > 0 && !port.enabled) {
      recommendations.push({
        port: port.port_number,
        action: 'enable',
        reason: `Port ${port.port_number} has ${activity} recent messages/calls but is disabled`,
        details: { sms_count: portSms.length, call_count: portCalls.length },
      });
    }

    // Detect ports with no label/phone
    if (port.enabled && !port.phone_number && portSms.length > 0) {
      // Try to detect the port's phone number from outbound caller IDs
      const outboundCalls = calls.filter(c => c.sim_port === port.port_number && c.direction === 'outbound');
      const likelyNumber = outboundCalls.length > 0 ? outboundCalls[0].caller_number : null;
      
      if (likelyNumber) {
        recommendations.push({
          port: port.port_number,
          action: 'set_phone',
          reason: `Detected likely phone number ${likelyNumber} for Port ${port.port_number}`,
          details: { detected_number: likelyNumber },
        });
      }
    }

    // Detect ports with no extension mapping
    if (port.enabled && (!port.extension || port.extension === '')) {
      recommendations.push({
        port: port.port_number,
        action: 'set_extension',
        reason: `Port ${port.port_number} (${port.label}) has no PBX extension mapped`,
        details: { suggested_extension: `100${port.port_number - 1}` },
      });
    }
  }

  // Use AI for deeper analysis
  if (apiKey && ports.length > 0) {
    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [{
            role: 'system',
            content: 'You are a telecom SIM port configuration expert for TG400 gateways. Analyze port data and suggest optimal configurations.',
          }, {
            role: 'user',
            content: `Analyze these SIM ports and suggest configuration improvements:
Ports: ${JSON.stringify(ports)}
Recent SMS activity per port: ${JSON.stringify(ports.map(p => ({ port: p.port_number, sms: smsMessages.filter(s => s.sim_port === p.port_number).length, calls: calls.filter(c => c.sim_port === p.port_number).length })))}
Current agent config: ${JSON.stringify(configs.map(c => ({ key: c.config_key, value: c.config_value })))}`,
          }],
          tools: [{
            type: 'function',
            function: {
              name: 'suggest_sim_config',
              description: 'Suggest SIM port configuration changes',
              parameters: {
                type: 'object',
                properties: {
                  suggestions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        port: { type: 'number' },
                        action: { type: 'string' },
                        reason: { type: 'string' },
                      },
                      required: ['port', 'action', 'reason'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['suggestions'],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: 'function', function: { name: 'suggest_sim_config' } },
          temperature: 0.3,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          const parsed = JSON.parse(toolCall.function.arguments);
          for (const s of parsed.suggestions || []) {
            // Avoid duplicates
            if (!recommendations.find(r => r.port === s.port && r.action === s.action)) {
              recommendations.push({ port: s.port, action: s.action, reason: s.reason, details: {} });
            }
          }
        }
      }
    } catch (e) {
      console.error('[AI] SIM config AI call failed:', e);
    }
  }

  // Store recommendations
  if (recommendations.length > 0) {
    const inserts = recommendations.map(r => ({
      category: 'sim_config',
      title: `Port ${r.port}: ${r.action}`,
      description: r.reason,
      details: r.details,
      status: 'pending',
      auto_applied: false,
    }));

    await supabase.from('ai_recommendations').insert(inserts);

    await supabase.from('activity_logs').insert({
      event_type: 'ai_sim_config',
      message: `AI found ${recommendations.length} SIM configuration recommendation(s)`,
      severity: 'info',
      metadata: { count: recommendations.length },
    });
  }

  return { recommendations_count: recommendations.length, recommendations };
}

// ========== AUTO-CREATE CONTACTS ==========
async function autoCreateContacts(supabase: ReturnType<typeof createClient>, apiKey?: string) {
  console.log('[AI] Running auto-contact creation...');

  // Find phone numbers with SMS/calls but no named contact
  const { data: unnamedContacts } = await supabase
    .from('contacts')
    .select('id, phone_number, sms_count, call_count')
    .is('name', null)
    .gt('sms_count', 0)
    .order('sms_count', { ascending: false })
    .limit(50);

  if (!unnamedContacts || unnamedContacts.length === 0) {
    return { contacts_analyzed: 0, names_suggested: 0, suggestions: [] };
  }

  // Get recent SMS messages from these contacts to infer names
  const suggestions: Array<{ phone: string; suggested_name: string; confidence: string; source: string }> = [];

  for (const contact of unnamedContacts) {
    const { data: messages } = await supabase
      .from('sms_messages')
      .select('message_content, category')
      .eq('sender_number', contact.phone_number)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!messages || messages.length === 0) continue;

    // Check for business signatures in messages
    const allContent = messages.map(m => m.message_content).join('\n');
    
    // Pattern-based name extraction
    const namePatterns = [
      /(?:regards|sincerely|thanks|cheers),?\s*\n?\s*([A-Z][a-z]+ [A-Z][a-z]+)/i,
      /(?:this is|i am|my name is)\s+([A-Z][a-z]+ [A-Z][a-z]+)/i,
      /^([A-Z][a-z]+ [A-Z][a-z]+)\s*$/m,
    ];

    for (const pattern of namePatterns) {
      const match = allContent.match(pattern);
      if (match) {
        suggestions.push({
          phone: contact.phone_number,
          suggested_name: match[1].trim(),
          confidence: 'medium',
          source: 'pattern_match',
        });
        break;
      }
    }

    // If OTP/transactional, try to extract brand
    const otpMessages = messages.filter(m => m.category === 'otp' || m.category === 'transactional');
    if (otpMessages.length > 0 && !suggestions.find(s => s.phone === contact.phone_number)) {
      const brandPatterns = [
        /(?:from|by)\s+([A-Z][A-Za-z0-9]+)/,
        /^([A-Z]{2,}[A-Za-z]*)/m,
      ];
      for (const pattern of brandPatterns) {
        const match = otpMessages[0].message_content.match(pattern);
        if (match) {
          suggestions.push({
            phone: contact.phone_number,
            suggested_name: match[1].trim(),
            confidence: 'low',
            source: 'brand_extraction',
          });
          break;
        }
      }
    }
  }

  // Use AI for remaining unnamed contacts
  if (apiKey && unnamedContacts.length > suggestions.length) {
    const unresolved = unnamedContacts.filter(c => !suggestions.find(s => s.phone === c.phone_number)).slice(0, 10);
    
    if (unresolved.length > 0) {
      const contactData = [];
      for (const c of unresolved) {
        const { data: msgs } = await supabase
          .from('sms_messages')
          .select('message_content, category')
          .eq('sender_number', c.phone_number)
          .limit(3);
        contactData.push({ phone: c.phone_number, sms_count: c.sms_count, call_count: c.call_count, sample_messages: msgs?.map(m => m.message_content.substring(0, 100)) });
      }

      try {
        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-3-flash-preview',
            messages: [{
              role: 'system',
              content: 'You are a contact identification expert. Analyze SMS patterns to suggest contact names or labels.',
            }, {
              role: 'user',
              content: `Identify who these phone numbers likely belong to based on their SMS patterns:\n${JSON.stringify(contactData, null, 2)}`,
            }],
            tools: [{
              type: 'function',
              function: {
                name: 'identify_contacts',
                description: 'Identify contacts from SMS patterns',
                parameters: {
                  type: 'object',
                  properties: {
                    contacts: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          phone: { type: 'string' },
                          name: { type: 'string' },
                          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
                        },
                        required: ['phone', 'name', 'confidence'],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ['contacts'],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: 'function', function: { name: 'identify_contacts' } },
            temperature: 0.3,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall?.function?.arguments) {
            const parsed = JSON.parse(toolCall.function.arguments);
            for (const c of parsed.contacts || []) {
              suggestions.push({ phone: c.phone, suggested_name: c.name, confidence: c.confidence, source: 'ai_analysis' });
            }
          }
        }
      } catch (e) {
        console.error('[AI] Contact identification failed:', e);
      }
    }
  }

  // Store as recommendations (don't auto-apply names to avoid mistakes)
  if (suggestions.length > 0) {
    const inserts = suggestions.map(s => ({
      category: 'contact',
      title: `Name: ${s.suggested_name}`,
      description: `Suggested name "${s.suggested_name}" for ${s.phone} (${s.confidence} confidence, via ${s.source})`,
      details: s,
      status: 'pending',
      auto_applied: false,
    }));

    await supabase.from('ai_recommendations').insert(inserts);
  }

  return { contacts_analyzed: unnamedContacts.length, names_suggested: suggestions.length, suggestions };
}

// ========== SUGGEST DASHBOARD ACTIONS ==========
async function suggestDashboardActions(supabase: ReturnType<typeof createClient>, apiKey?: string) {
  console.log('[AI] Generating dashboard action suggestions...');

  // Gather system state
  const [errorsResult, portsResult, smsResult, heartbeatResult, configResult] = await Promise.all([
    supabase.from('error_logs').select('error_type, error_message, resolved, created_at').eq('resolved', false).order('created_at', { ascending: false }).limit(20),
    supabase.from('sim_port_config').select('*'),
    supabase.from('sms_messages').select('id, status, category, created_at').eq('status', 'unread').limit(100),
    supabase.from('agent_heartbeat').select('*').order('last_seen_at', { ascending: false }).limit(1),
    supabase.from('agent_config').select('*'),
  ]);

  const unresolvedErrors = errorsResult.data || [];
  const ports = portsResult.data || [];
  const unreadSms = smsResult.data || [];
  const heartbeat = heartbeatResult.data?.[0];
  const configs = configResult.data || [];

  const actions: Array<{ priority: 'high' | 'medium' | 'low'; title: string; description: string; action_type: string; details: Record<string, unknown> }> = [];

  // Check for critical issues
  if (!heartbeat || (Date.now() - new Date(heartbeat.last_seen_at).getTime()) > 5 * 60 * 1000) {
    actions.push({
      priority: 'high',
      title: 'Agent Offline',
      description: 'The polling agent has not sent a heartbeat in 5+ minutes. Check the agent server.',
      action_type: 'check_agent',
      details: { last_seen: heartbeat?.last_seen_at },
    });
  }

  if (unresolvedErrors.length > 10) {
    actions.push({
      priority: 'high',
      title: 'Clear Error Backlog',
      description: `${unresolvedErrors.length} unresolved errors. Run AI diagnostics to triage and resolve.`,
      action_type: 'diagnose_errors',
      details: { count: unresolvedErrors.length },
    });
  }

  if (unreadSms.length > 50) {
    actions.push({
      priority: 'medium',
      title: 'Process SMS Backlog',
      description: `${unreadSms.length} unread SMS messages. Review and categorize.`,
      action_type: 'review_sms',
      details: { count: unreadSms.length },
    });
  }

  const disabledPorts = ports.filter(p => !p.enabled);
  if (disabledPorts.length > 0) {
    actions.push({
      priority: 'low',
      title: 'Enable Idle SIM Ports',
      description: `${disabledPorts.length} SIM port(s) are disabled. Consider enabling for redundancy.`,
      action_type: 'enable_ports',
      details: { ports: disabledPorts.map(p => p.port_number) },
    });
  }

  // AI-enhanced suggestions
  if (apiKey) {
    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [{
            role: 'system',
            content: 'You are a system operations advisor for a TG400 SMS gateway + S100 PBX system. Suggest actionable improvements based on system state.',
          }, {
            role: 'user',
            content: `System state:
- Unresolved errors: ${unresolvedErrors.length}
- SIM ports: ${JSON.stringify(ports.map(p => ({ port: p.port_number, enabled: p.enabled, signal: p.signal_strength, carrier: p.carrier })))}
- Unread SMS: ${unreadSms.length}
- Agent status: ${heartbeat ? 'online' : 'offline'}
- Config: ${JSON.stringify(configs.map(c => ({ key: c.config_key, value: c.config_value, ai_tuned: c.ai_tuned })))}
Suggest 1-3 additional action items.`,
          }],
          tools: [{
            type: 'function',
            function: {
              name: 'suggest_actions',
              description: 'Suggest system actions',
              parameters: {
                type: 'object',
                properties: {
                  actions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                        title: { type: 'string' },
                        description: { type: 'string' },
                      },
                      required: ['priority', 'title', 'description'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['actions'],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: 'function', function: { name: 'suggest_actions' } },
          temperature: 0.4,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          const parsed = JSON.parse(toolCall.function.arguments);
          for (const a of parsed.actions || []) {
            actions.push({ ...a, action_type: 'ai_suggestion', details: {} });
          }
        }
      }
    } catch (e) {
      console.error('[AI] Action suggestion failed:', e);
    }
  }

  // Store as recommendations
  if (actions.length > 0) {
    const inserts = actions.map(a => ({
      category: 'action',
      title: a.title,
      description: a.description,
      details: { priority: a.priority, action_type: a.action_type, ...a.details },
      status: 'pending',
      auto_applied: false,
    }));

    await supabase.from('ai_recommendations').insert(inserts);
  }

  return { actions_count: actions.length, actions };
}

// ========== RESOURCE OPTIMIZATION ==========
async function optimizeResources(supabase: ReturnType<typeof createClient>, apiKey?: string) {
  console.log('[AI] Running resource optimization...');

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [portsResult, smsResult, callsResult, errorsResult, configResult] = await Promise.all([
    supabase.from('sim_port_config').select('*'),
    supabase.from('sms_messages').select('sim_port, created_at').gte('created_at', oneWeekAgo),
    supabase.from('call_records').select('sim_port, created_at, status, total_duration').gte('created_at', oneWeekAgo),
    supabase.from('error_logs').select('error_type, error_message, created_at').gte('created_at', oneDayAgo),
    supabase.from('agent_config').select('*'),
  ]);

  const ports = portsResult.data || [];
  const smsMessages = smsResult.data || [];
  const calls = callsResult.data || [];
  const errors = errorsResult.data || [];
  const configs = configResult.data || [];

  const optimizations: Array<{ type: string; title: string; description: string; auto_applied: boolean; details: Record<string, unknown> }> = [];

  // Analyze port utilization
  const portStats = ports.map(p => {
    const portSms = smsMessages.filter(s => s.sim_port === p.port_number);
    const portCalls = calls.filter(c => c.sim_port === p.port_number);
    const totalActivity = portSms.length + portCalls.length;
    const failedCalls = portCalls.filter(c => c.status === 'failed').length;
    const failRate = portCalls.length > 0 ? failedCalls / portCalls.length : 0;

    return {
      port: p.port_number,
      enabled: p.enabled,
      label: p.label,
      signal: p.signal_strength,
      sms_count: portSms.length,
      call_count: portCalls.length,
      total_activity: totalActivity,
      fail_rate: failRate,
    };
  });

  const enabledPorts = portStats.filter(p => p.enabled);
  const totalActivity = enabledPorts.reduce((sum, p) => sum + p.total_activity, 0);
  const avgActivity = enabledPorts.length > 0 ? totalActivity / enabledPorts.length : 0;

  // Detect imbalanced load
  for (const port of enabledPorts) {
    if (port.total_activity > avgActivity * 2 && enabledPorts.length > 1) {
      optimizations.push({
        type: 'load_balance',
        title: `Port ${port.port} Overloaded`,
        description: `Port ${port.port} (${port.label}) handles ${port.total_activity} msg/calls vs avg ${Math.round(avgActivity)}. Redistribute load.`,
        auto_applied: false,
        details: { port: port.port, activity: port.total_activity, average: Math.round(avgActivity) },
      });
    }

    if (port.fail_rate > 0.3) {
      optimizations.push({
        type: 'reliability',
        title: `Port ${port.port} High Fail Rate`,
        description: `Port ${port.port} has ${Math.round(port.fail_rate * 100)}% call failure rate. Consider checking SIM or disabling port.`,
        auto_applied: false,
        details: { port: port.port, fail_rate: port.fail_rate },
      });
    }

    if (port.signal !== null && port.signal < 10 && port.signal > 0) {
      optimizations.push({
        type: 'signal',
        title: `Port ${port.port} Weak Signal`,
        description: `Port ${port.port} signal strength is ${port.signal}%. May cause message delivery issues.`,
        auto_applied: false,
        details: { port: port.port, signal: port.signal },
      });
    }
  }

  // Auto-tune polling based on load
  const errorRate = errors.length;
  const pollConfig = configs.find(c => c.config_key === 'poll_interval');
  const currentPoll = (pollConfig?.config_value as Record<string, number>)?.value || 30000;

  if (errorRate < 3 && totalActivity > 100 && currentPoll > 15000) {
    const newPoll = Math.max(10000, Math.round(currentPoll * 0.7));
    await supabase.from('agent_config').upsert({
      config_key: 'poll_interval',
      config_value: { ...pollConfig?.config_value, value: newPoll },
      ai_tuned: true,
      last_tuned_at: new Date().toISOString(),
    }, { onConflict: 'config_key' });

    optimizations.push({
      type: 'performance',
      title: 'Polling Interval Optimized',
      description: `Reduced poll interval from ${currentPoll}ms to ${newPoll}ms for faster message delivery (low error rate).`,
      auto_applied: true,
      details: { old_value: currentPoll, new_value: newPoll },
    });
  } else if (errorRate > 20 && currentPoll < 60000) {
    const newPoll = Math.min(90000, Math.round(currentPoll * 1.5));
    await supabase.from('agent_config').upsert({
      config_key: 'poll_interval',
      config_value: { ...pollConfig?.config_value, value: newPoll },
      ai_tuned: true,
      last_tuned_at: new Date().toISOString(),
    }, { onConflict: 'config_key' });

    optimizations.push({
      type: 'performance',
      title: 'Polling Interval Increased',
      description: `Increased poll interval from ${currentPoll}ms to ${newPoll}ms to reduce error load.`,
      auto_applied: true,
      details: { old_value: currentPoll, new_value: newPoll },
    });
  }

  // Store non-auto-applied optimizations as recommendations
  const pending = optimizations.filter(o => !o.auto_applied);
  if (pending.length > 0) {
    await supabase.from('ai_recommendations').insert(pending.map(o => ({
      category: 'resource',
      title: o.title,
      description: o.description,
      details: o.details,
      status: 'pending',
      auto_applied: false,
    })));
  }

  await supabase.from('activity_logs').insert({
    event_type: 'ai_resource_optimize',
    message: `Resource optimization: ${optimizations.length} finding(s), ${optimizations.filter(o => o.auto_applied).length} auto-applied`,
    severity: 'info',
    metadata: { port_stats: portStats, optimizations_count: optimizations.length },
  });

  return {
    port_stats: portStats,
    optimizations_count: optimizations.length,
    auto_applied_count: optimizations.filter(o => o.auto_applied).length,
    optimizations,
  };
}

// ========== APPLY RECOMMENDATION ==========
async function applyRecommendation(supabase: ReturnType<typeof createClient>, recommendationId: string) {
  const { data: rec, error } = await supabase
    .from('ai_recommendations')
    .select('*')
    .eq('id', recommendationId)
    .single();

  if (error || !rec) throw new Error('Recommendation not found');

  if (rec.category === 'contact' && rec.details?.phone && rec.details?.suggested_name) {
    await supabase.from('contacts').update({ name: rec.details.suggested_name }).eq('phone_number', rec.details.phone);
  }

  if (rec.category === 'sim_config' && rec.details?.port) {
    const portNum = rec.details.port || (rec.title ? parseInt(rec.title.match(/Port (\d+)/)?.[1] || '0') : 0);
    if (rec.title.includes('enable')) {
      await supabase.from('sim_port_config').update({ enabled: true }).eq('port_number', portNum);
    }
    if (rec.details.detected_number) {
      await supabase.from('sim_port_config').update({ phone_number: rec.details.detected_number }).eq('port_number', portNum);
    }
    if (rec.details.suggested_extension) {
      await supabase.from('sim_port_config').update({ extension: rec.details.suggested_extension }).eq('port_number', portNum);
    }
  }

  await supabase.from('ai_recommendations').update({
    status: 'applied',
    auto_applied: false,
    applied_at: new Date().toISOString(),
  }).eq('id', recommendationId);

  await supabase.from('activity_logs').insert({
    event_type: 'ai_recommendation_applied',
    message: `Applied AI recommendation: ${rec.title}`,
    severity: 'success',
    metadata: { recommendation_id: recommendationId, category: rec.category },
  });

  return { applied: true, recommendation: rec };
}

// ========== EXISTING HELPER FUNCTIONS ==========

async function diagnoseWithAI(errorLog: ErrorLog, apiKey?: string): Promise<DiagnosisResult> {
  const quickDiagnosis = getQuickDiagnosis(errorLog);
  if (quickDiagnosis) return quickDiagnosis;

  if (apiKey) {
    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            {
              role: 'system',
              content: `You are an expert system diagnostician for a TG400 SMS gateway and S100 PBX integration system.
Analyze errors and provide actionable fixes.`
            },
            {
              role: 'user',
              content: `Diagnose this error:
Type: ${errorLog.error_type}
Message: ${errorLog.error_message}
Context: ${JSON.stringify(errorLog.error_context || {})}`
            }
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'diagnose_error',
              description: 'Provide diagnosis and fix for the error',
              parameters: {
                type: 'object',
                properties: {
                  diagnosis: { type: 'string', description: 'Brief explanation of the problem' },
                  suggested_fix: { type: 'string', description: 'Step-by-step fix instructions' },
                  auto_fixable: { type: 'boolean', description: 'Whether fix can be automated' },
                  fix_action: { type: 'string', enum: ['retry', 'restart', 'reconfigure', 'escalate'] }
                },
                required: ['diagnosis', 'suggested_fix', 'auto_fixable'],
                additionalProperties: false
              }
            }
          }],
          tool_choice: { type: 'function', function: { name: 'diagnose_error' } },
          temperature: 0.3,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          return JSON.parse(toolCall.function.arguments);
        }
      }
    } catch (aiError) {
      console.error('[AI Diagnostics] AI call failed:', aiError);
    }
  }

  return {
    diagnosis: `Error of type "${errorLog.error_type}" occurred`,
    suggested_fix: 'Check connectivity and credentials, then restart the agent if needed',
    auto_fixable: false,
  };
}

function getQuickDiagnosis(errorLog: ErrorLog): DiagnosisResult | null {
  const errorMessage = errorLog.error_message.toLowerCase();

  if (errorMessage.includes('timeout') || errorMessage.includes('econnrefused')) {
    return {
      diagnosis: 'Network connection failed - device may be unreachable',
      suggested_fix: 'Auto-retry with exponential backoff. If persistent, check network connectivity.',
      auto_fixable: true,
      fix_action: 'retry',
    };
  }

  if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
    return {
      diagnosis: 'Authentication failed - credentials may be incorrect',
      suggested_fix: 'Verify API username and password in gateway configuration.',
      auto_fixable: false,
      fix_action: 'reconfigure',
    };
  }

  if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
    return {
      diagnosis: 'API rate limit exceeded',
      suggested_fix: 'Automatically increase polling interval.',
      auto_fixable: true,
      fix_action: 'retry',
    };
  }

  return null;
}

async function predictMaintenance(supabase: ReturnType<typeof createClient>, apiKey?: string): Promise<PredictiveAlert> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const [errorsResult, heartbeatResult, smsResult] = await Promise.all([
    supabase.from('error_logs').select('error_type, error_message, created_at').gte('created_at', oneDayAgo),
    supabase.from('agent_heartbeat').select('*').order('last_seen_at', { ascending: false }).limit(5),
    supabase.from('sms_messages').select('id, created_at').gte('created_at', oneHourAgo),
  ]);

  const errors = errorsResult.data || [];
  const heartbeats = heartbeatResult.data || [];
  const recentSms = smsResult.data || [];

  const errorRate = errors.length;
  const timeoutErrors = errors.filter(e => e.error_message.toLowerCase().includes('timeout')).length;
  const authErrors = errors.filter(e => e.error_message.toLowerCase().includes('401')).length;
  
  const latestHeartbeat = heartbeats[0];
  const agentOffline = !latestHeartbeat || 
    (Date.now() - new Date(latestHeartbeat.last_seen_at).getTime()) > 5 * 60 * 1000;
  
  const consecutiveErrors = (latestHeartbeat?.metadata as Record<string, number>)?.consecutive_errors || 0;
  const smsVolume = recentSms.length;

  let riskLevel: PredictiveAlert['risk_level'] = 'low';
  let prediction = 'System is operating normally';
  let recommendedAction = 'No action needed';
  let autoApplied = false;

  if (agentOffline) {
    riskLevel = 'critical';
    prediction = 'Agent appears to be offline or unresponsive';
    recommendedAction = 'Check agent server, may need manual restart';
  } else if (consecutiveErrors >= 5 || errorRate > 50) {
    riskLevel = 'high';
    prediction = 'High error rate detected, system instability imminent';
    recommendedAction = 'Increase polling interval and trigger agent self-heal';
    
    await supabase.from('agent_config').upsert({
      config_key: 'poll_interval',
      config_value: { value: 60000, min: 5000, max: 300000, unit: 'ms' },
      ai_tuned: true,
      last_tuned_at: new Date().toISOString(),
    }, { onConflict: 'config_key' });
    autoApplied = true;
  } else if (timeoutErrors > 10) {
    riskLevel = 'medium';
    prediction = 'Gateway connectivity issues detected, may cause message delays';
    recommendedAction = 'Consider increasing poll interval or checking network';
    
    const currentConfig = await supabase.from('agent_config').select('*').eq('config_key', 'poll_interval').single();
    const currentValue = (currentConfig.data?.config_value as Record<string, number>)?.value || 30000;
    await supabase.from('agent_config').upsert({
      config_key: 'poll_interval',
      config_value: { value: Math.min(currentValue * 1.5, 120000), min: 5000, max: 300000, unit: 'ms' },
      ai_tuned: true,
      last_tuned_at: new Date().toISOString(),
    }, { onConflict: 'config_key' });
    autoApplied = true;
  } else if (authErrors > 3) {
    riskLevel = 'medium';
    prediction = 'Authentication issues detected, gateway access may fail';
    recommendedAction = 'Verify gateway credentials in configuration';
  } else if (smsVolume === 0 && !agentOffline) {
    riskLevel = 'low';
    prediction = 'No SMS activity in the last hour - this may be normal or indicate a polling issue';
    recommendedAction = 'Monitor for continued inactivity';
  }

  await supabase.from('activity_logs').insert({
    event_type: 'ai_prediction',
    message: `Predictive maintenance: ${riskLevel.toUpperCase()} - ${prediction}`,
    severity: riskLevel === 'critical' ? 'error' : riskLevel === 'high' ? 'warning' : 'info',
    metadata: { 
      risk_level: riskLevel, 
      prediction, 
      auto_applied: autoApplied,
      metrics: { errorRate, timeoutErrors, authErrors, consecutiveErrors, smsVolume }
    },
  });

  return { risk_level: riskLevel, prediction, recommended_action: recommendedAction, auto_applied: autoApplied };
}

async function tuneConfiguration(supabase: ReturnType<typeof createClient>, apiKey?: string) {
  const { data: recentErrors } = await supabase
    .from('error_logs')
    .select('error_type, error_message, created_at')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(100);

  const { data: heartbeats } = await supabase
    .from('agent_heartbeat')
    .select('*')
    .order('last_seen_at', { ascending: false })
    .limit(10);

  const { data: currentConfig } = await supabase.from('agent_config').select('*');

  const errorCount = recentErrors?.length || 0;
  const timeoutErrors = recentErrors?.filter(e => e.error_message.toLowerCase().includes('timeout')).length || 0;
  const recommendations: Record<string, unknown>[] = [];

  if (timeoutErrors > 10) {
    const pollConfig = currentConfig?.find(c => c.config_key === 'poll_interval');
    const currentValue = (pollConfig?.config_value as Record<string, number>)?.value || 30000;
    const newValue = Math.min(currentValue * 1.5, 120000);

    await supabase.from('agent_config').upsert({
      config_key: 'poll_interval',
      config_value: { ...pollConfig?.config_value, value: newValue },
      ai_tuned: true,
      last_tuned_at: new Date().toISOString(),
    }, { onConflict: 'config_key' });

    recommendations.push({
      config: 'poll_interval',
      old_value: currentValue,
      new_value: newValue,
      reason: 'High timeout errors - increasing interval to reduce load',
    });
  }

  if (errorCount < 5 && heartbeats?.length > 0) {
    const pollConfig = currentConfig?.find(c => c.config_key === 'poll_interval');
    const currentValue = (pollConfig?.config_value as Record<string, number>)?.value || 30000;
    const minValue = (pollConfig?.config_value as Record<string, number>)?.min || 5000;
    
    if (currentValue > minValue * 2) {
      const newValue = Math.max(currentValue * 0.8, minValue);
      
      await supabase.from('agent_config').upsert({
        config_key: 'poll_interval',
        config_value: { ...pollConfig?.config_value, value: Math.round(newValue) },
        ai_tuned: true,
        last_tuned_at: new Date().toISOString(),
      }, { onConflict: 'config_key' });

      recommendations.push({
        config: 'poll_interval',
        old_value: currentValue,
        new_value: Math.round(newValue),
        reason: 'Low error rate - optimizing for faster message delivery',
      });
    }
  }

  if (recommendations.length > 0) {
    await supabase.from('activity_logs').insert({
      event_type: 'ai_config_tuning',
      message: `AI auto-tuned ${recommendations.length} configuration(s)`,
      severity: 'info',
      metadata: { recommendations },
    });
  }

  return { recommendations, error_count: errorCount };
}

async function learnFromFeedback(supabase: ReturnType<typeof createClient>, apiKey?: string) {
  const { data: feedback } = await supabase
    .from('sms_category_feedback')
    .select('*, sms_messages!inner(message_content, sender_number)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!feedback || feedback.length === 0) {
    return { message: 'No feedback data to learn from', patterns_found: 0, feedback_count: 0, insights: [], ai_rules: [] };
  }

  const corrections: Record<string, Record<string, number>> = {};
  const examplesByCorrection: Record<string, string[]> = {};
  
  for (const f of feedback) {
    const key = `${f.original_category}->${f.corrected_category}`;
    if (!corrections[f.original_category]) corrections[f.original_category] = {};
    corrections[f.original_category][f.corrected_category] = 
      (corrections[f.original_category][f.corrected_category] || 0) + 1;
    
    if (!examplesByCorrection[key]) examplesByCorrection[key] = [];
    if ((f.sms_messages as Record<string, string>)?.message_content && examplesByCorrection[key].length < 5) {
      examplesByCorrection[key].push((f.sms_messages as Record<string, string>).message_content);
    }
  }

  const insights: string[] = [];
  const learningData: Record<string, unknown>[] = [];
  
  for (const [original, correctedMap] of Object.entries(corrections)) {
    for (const [corrected, count] of Object.entries(correctedMap)) {
      if (count >= 3) {
        const key = `${original}->${corrected}`;
        insights.push(`"${original}" is often "${corrected}" (${count}x)`);
        learningData.push({
          original_category: original,
          corrected_category: corrected,
          correction_count: count,
          examples: examplesByCorrection[key] || [],
        });
      }
    }
  }

  let aiRules: string[] = [];
  if (apiKey && learningData.length > 0) {
    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [{
            role: 'system',
            content: 'You are an SMS classification expert. Analyze misclassification patterns and suggest improved rules.'
          }, {
            role: 'user',
            content: `Based on user corrections, suggest improved classification rules:\n${JSON.stringify(learningData, null, 2)}\n\nProvide 3-5 specific rules.`
          }],
          tools: [{
            type: 'function',
            function: {
              name: 'suggest_rules',
              description: 'Suggest classification rules',
              parameters: {
                type: 'object',
                properties: {
                  rules: { type: 'array', items: { type: 'string' } }
                },
                required: ['rules'],
                additionalProperties: false
              }
            }
          }],
          tool_choice: { type: 'function', function: { name: 'suggest_rules' } },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          const parsed = JSON.parse(toolCall.function.arguments);
          aiRules = parsed.rules || [];
        }
      }
    } catch (e) {
      console.error('[AI Learning] Failed to generate rules:', e);
    }
  }

  await supabase.from('agent_config').upsert({
    config_key: 'sms_classification_rules',
    config_value: { 
      learned_patterns: learningData,
      ai_rules: aiRules,
      last_learned_at: new Date().toISOString(),
      feedback_count: feedback.length,
    },
    ai_tuned: true,
    last_tuned_at: new Date().toISOString(),
  }, { onConflict: 'config_key' });

  await supabase.from('activity_logs').insert({
    event_type: 'ai_learning',
    message: `AI learned from ${feedback.length} corrections, found ${insights.length} patterns`,
    severity: 'success',
    metadata: { corrections, insights, ai_rules: aiRules },
  });

  return { feedback_count: feedback.length, patterns_found: insights.length, insights, ai_rules: aiRules };
}
