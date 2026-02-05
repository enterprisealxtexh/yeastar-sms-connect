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
    
    const supabase = createClient(supabaseUrl, supabaseKey);
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

    // ========== AUTO-RUN ALL OPTIMIZATIONS ==========
    if (action === 'auto_optimize') {
      console.log('[AI Diagnostics] Running full auto-optimization cycle...');
      
      const results = {
        prediction: await predictMaintenance(supabase, lovableApiKey),
        tuning: await tuneConfiguration(supabase, lovableApiKey),
        learning: await learnFromFeedback(supabase, lovableApiKey),
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
  // Gather system health metrics
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

  // Analyze patterns
  const errorRate = errors.length;
  const timeoutErrors = errors.filter(e => e.error_message.toLowerCase().includes('timeout')).length;
  const authErrors = errors.filter(e => e.error_message.toLowerCase().includes('401')).length;
  
  const latestHeartbeat = heartbeats[0];
  const agentOffline = !latestHeartbeat || 
    (Date.now() - new Date(latestHeartbeat.last_seen_at).getTime()) > 5 * 60 * 1000;
  
  const consecutiveErrors = latestHeartbeat?.metadata?.consecutive_errors || 0;
  const smsVolume = recentSms.length;

  // Determine risk level and prediction
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
    
    // Auto-apply fix
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
    
    // Auto-apply fix
    const currentConfig = await supabase.from('agent_config').select('*').eq('config_key', 'poll_interval').single();
    const currentValue = currentConfig.data?.config_value?.value || 30000;
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

  // Log the prediction
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

  // High timeout rate = increase interval
  if (timeoutErrors > 10) {
    const pollConfig = currentConfig?.find(c => c.config_key === 'poll_interval');
    const currentValue = pollConfig?.config_value?.value || 30000;
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

  // Low error rate = can decrease interval for faster sync
  if (errorCount < 5 && heartbeats?.length > 0) {
    const pollConfig = currentConfig?.find(c => c.config_key === 'poll_interval');
    const currentValue = pollConfig?.config_value?.value || 30000;
    const minValue = pollConfig?.config_value?.min || 5000;
    
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
    return { message: 'No feedback data to learn from', patterns_found: 0 };
  }

  // Analyze correction patterns
  const corrections: Record<string, Record<string, number>> = {};
  const examplesByCorrection: Record<string, string[]> = {};
  
  for (const f of feedback) {
    const key = `${f.original_category}->${f.corrected_category}`;
    if (!corrections[f.original_category]) corrections[f.original_category] = {};
    corrections[f.original_category][f.corrected_category] = 
      (corrections[f.original_category][f.corrected_category] || 0) + 1;
    
    // Store examples for learning
    if (!examplesByCorrection[key]) examplesByCorrection[key] = [];
    if (f.sms_messages?.message_content && examplesByCorrection[key].length < 5) {
      examplesByCorrection[key].push(f.sms_messages.message_content);
    }
  }

  // Find patterns that need attention
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

  // Use AI to generate improved classification rules
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
          messages: [
            {
              role: 'system',
              content: 'You are an SMS classification expert. Analyze misclassification patterns and suggest improved rules.'
            },
            {
              role: 'user',
              content: `Based on user corrections, suggest improved classification rules:
${JSON.stringify(learningData, null, 2)}

Provide 3-5 specific rules that would prevent these misclassifications.`
            }
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'suggest_rules',
              description: 'Suggest classification rules',
              parameters: {
                type: 'object',
                properties: {
                  rules: { 
                    type: 'array', 
                    items: { type: 'string' },
                    description: 'List of classification rules'
                  }
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

  // Store learning results
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

  return {
    feedback_count: feedback.length,
    patterns_found: insights.length,
    insights,
    ai_rules: aiRules,
  };
}
