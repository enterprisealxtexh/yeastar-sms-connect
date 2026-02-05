import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { action, error_id, error_data } = await req.json();

    if (action === 'diagnose') {
      // Diagnose a specific error
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

      // Use AI to diagnose the error
      const diagnosis = await diagnoseWithAI(errorLog, lovableApiKey);

      // Update the error log with diagnosis
      if (error_id) {
        await supabase
          .from('error_logs')
          .update({
            ai_diagnosis: diagnosis.diagnosis,
            ai_suggested_fix: diagnosis.suggested_fix,
          })
          .eq('id', error_id);
      }

      // Log the diagnosis activity
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

    if (action === 'tune_config') {
      // AI-powered configuration tuning based on usage patterns
      const tuningResult = await tuneConfiguration(supabase, lovableApiKey);

      return new Response(
        JSON.stringify({ success: true, tuning: tuningResult }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'learn_categorization') {
      // Learn from SMS category corrections
      const learningResult = await learnFromFeedback(supabase, lovableApiKey);

      return new Response(
        JSON.stringify({ success: true, learning: learningResult }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'check_updates') {
      // Check for agent updates
      const { data: latestUpdate } = await supabase
        .from('agent_updates')
        .select('*')
        .order('released_at', { ascending: false })
        .limit(1)
        .single();

      return new Response(
        JSON.stringify({ success: true, latest_version: latestUpdate }),
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

async function diagnoseWithAI(errorLog: ErrorLog, apiKey?: string): Promise<DiagnosisResult> {
  // Rule-based diagnosis for common errors (fast path)
  const quickDiagnosis = getQuickDiagnosis(errorLog);
  if (quickDiagnosis) {
    return quickDiagnosis;
  }

  // Use AI for complex errors
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
Analyze errors and provide:
1. A clear diagnosis of what went wrong
2. A suggested fix that can be implemented
3. Whether the fix can be automated

Respond in JSON format:
{
  "diagnosis": "Brief explanation of the problem",
  "suggested_fix": "Step-by-step fix instructions",
  "auto_fixable": true/false,
  "fix_action": "retry|restart|reconfigure|escalate"
}`
            },
            {
              role: 'user',
              content: `Diagnose this error:
Type: ${errorLog.error_type}
Message: ${errorLog.error_message}
Context: ${JSON.stringify(errorLog.error_context || {})}`
            }
          ],
          temperature: 0.3,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          try {
            return JSON.parse(content);
          } catch {
            return {
              diagnosis: content,
              suggested_fix: 'Review the error details and take appropriate action',
              auto_fixable: false,
            };
          }
        }
      }
    } catch (aiError) {
      console.error('[AI Diagnostics] AI call failed:', aiError);
    }
  }

  // Fallback to generic diagnosis
  return {
    diagnosis: `Error of type "${errorLog.error_type}" occurred`,
    suggested_fix: 'Check connectivity and credentials, then restart the agent if needed',
    auto_fixable: false,
  };
}

function getQuickDiagnosis(errorLog: ErrorLog): DiagnosisResult | null {
  const errorType = errorLog.error_type.toLowerCase();
  const errorMessage = errorLog.error_message.toLowerCase();

  // Connection timeout
  if (errorMessage.includes('timeout') || errorMessage.includes('econnrefused')) {
    return {
      diagnosis: 'Network connection failed - the device may be unreachable or the service is down',
      suggested_fix: 'Auto-retry with exponential backoff. If persistent, check network connectivity and device power.',
      auto_fixable: true,
      fix_action: 'retry',
    };
  }

  // Authentication errors
  if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
    return {
      diagnosis: 'Authentication failed - credentials may be incorrect or expired',
      suggested_fix: 'Verify API username and password in the gateway configuration.',
      auto_fixable: false,
      fix_action: 'reconfigure',
    };
  }

  // Rate limiting
  if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
    return {
      diagnosis: 'API rate limit exceeded - too many requests in a short period',
      suggested_fix: 'Automatically increase polling interval and add delay between requests.',
      auto_fixable: true,
      fix_action: 'retry',
    };
  }

  // DNS/Network errors
  if (errorMessage.includes('enotfound') || errorMessage.includes('dns')) {
    return {
      diagnosis: 'DNS resolution failed - hostname cannot be resolved',
      suggested_fix: 'Check that the gateway IP/hostname is correct and DNS is working.',
      auto_fixable: false,
      fix_action: 'reconfigure',
    };
  }

  // Database errors
  if (errorType.includes('supabase') || errorMessage.includes('database')) {
    return {
      diagnosis: 'Database operation failed - possible connection or constraint issue',
      suggested_fix: 'Messages will be queued locally and synced when connection restores.',
      auto_fixable: true,
      fix_action: 'retry',
    };
  }

  return null;
}

async function tuneConfiguration(supabase: ReturnType<typeof createClient>, apiKey?: string) {
  // Get recent error patterns and usage stats
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

  const { data: currentConfig } = await supabase
    .from('agent_config')
    .select('*');

  // Analyze patterns
  const errorCount = recentErrors?.length || 0;
  const timeoutErrors = recentErrors?.filter(e => 
    e.error_message.toLowerCase().includes('timeout')
  ).length || 0;

  const recommendations: Record<string, unknown>[] = [];

  // If many timeouts, suggest increasing intervals
  if (timeoutErrors > 10) {
    const pollConfig = currentConfig?.find(c => c.config_key === 'poll_interval');
    const currentValue = pollConfig?.config_value?.value || 30000;
    const newValue = Math.min(currentValue * 1.5, 120000);

    await supabase
      .from('agent_config')
      .update({
        config_value: { ...pollConfig?.config_value, value: newValue },
        ai_tuned: true,
        last_tuned_at: new Date().toISOString(),
      })
      .eq('config_key', 'poll_interval');

    recommendations.push({
      config: 'poll_interval',
      old_value: currentValue,
      new_value: newValue,
      reason: 'High timeout errors detected - increasing interval to reduce load',
    });
  }

  // If error rate is low, can try decreasing intervals
  if (errorCount < 5 && heartbeats?.length > 0) {
    const pollConfig = currentConfig?.find(c => c.config_key === 'poll_interval');
    const currentValue = pollConfig?.config_value?.value || 30000;
    const minValue = pollConfig?.config_value?.min || 5000;
    
    if (currentValue > minValue * 2) {
      const newValue = Math.max(currentValue * 0.8, minValue);
      
      await supabase
        .from('agent_config')
        .update({
          config_value: { ...pollConfig?.config_value, value: Math.round(newValue) },
          ai_tuned: true,
          last_tuned_at: new Date().toISOString(),
        })
        .eq('config_key', 'poll_interval');

      recommendations.push({
        config: 'poll_interval',
        old_value: currentValue,
        new_value: Math.round(newValue),
        reason: 'Low error rate - optimizing for faster message delivery',
      });
    }
  }

  // Log tuning activity
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
  // Get recent category corrections
  const { data: feedback } = await supabase
    .from('sms_category_feedback')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!feedback || feedback.length === 0) {
    return { message: 'No feedback data to learn from' };
  }

  // Analyze correction patterns
  const corrections: Record<string, Record<string, number>> = {};
  
  for (const f of feedback) {
    if (!corrections[f.original_category]) {
      corrections[f.original_category] = {};
    }
    corrections[f.original_category][f.corrected_category] = 
      (corrections[f.original_category][f.corrected_category] || 0) + 1;
  }

  // Find common misclassifications
  const insights: string[] = [];
  for (const [original, correctedMap] of Object.entries(corrections)) {
    for (const [corrected, count] of Object.entries(correctedMap)) {
      if (count >= 3) {
        insights.push(`Messages classified as "${original}" are often actually "${corrected}" (${count} corrections)`);
      }
    }
  }

  // Log learning activity
  await supabase.from('activity_logs').insert({
    event_type: 'ai_learning',
    message: `AI analyzed ${feedback.length} category corrections`,
    severity: 'info',
    metadata: { corrections, insights },
  });

  return {
    feedback_count: feedback.length,
    correction_patterns: corrections,
    insights,
  };
}
