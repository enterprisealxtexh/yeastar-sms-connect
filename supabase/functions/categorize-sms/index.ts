import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const CATEGORY_DESCRIPTIONS = {
  otp: "One-time password or verification code",
  marketing: "Promotional content, sales, advertisements",
  personal: "Personal message from friends/family",
  transactional: "Order confirmations, receipts, shipping updates",
  notification: "System alerts, reminders, account updates",
  spam: "Unsolicited junk messages",
  unknown: "Cannot be classified"
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase environment variables not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { message_id, message_content, sender_number, batch } = await req.json();

    // Handle batch categorization
    if (batch) {
      const { data: messages, error: fetchError } = await supabase
        .from('sms_messages')
        .select('id, message_content, sender_number')
        .eq('category', 'unknown')
        .limit(50);

      if (fetchError) throw fetchError;

      if (!messages || messages.length === 0) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: "No uncategorized messages found",
          processed: 0 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`Processing batch of ${messages.length} messages`);

      const results = [];
      for (const msg of messages) {
        try {
          const result = await categorizeMessage(LOVABLE_API_KEY, msg.message_content, msg.sender_number);
          
          const { error: updateError } = await supabase
            .from('sms_messages')
            .update({ 
              category: result.category, 
              category_confidence: result.confidence 
            })
            .eq('id', msg.id);

          if (updateError) {
            console.error(`Failed to update message ${msg.id}:`, updateError);
          } else {
            results.push({ id: msg.id, ...result });
          }
        } catch (err) {
          console.error(`Failed to categorize message ${msg.id}:`, err);
        }
      }

      return new Response(JSON.stringify({ 
        success: true, 
        processed: results.length,
        results 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle single message categorization
    if (!message_content) {
      throw new Error("message_content is required");
    }

    const result = await categorizeMessage(LOVABLE_API_KEY, message_content, sender_number);

    // Update the message if ID provided
    if (message_id) {
      const { error: updateError } = await supabase
        .from('sms_messages')
        .update({ 
          category: result.category, 
          category_confidence: result.confidence 
        })
        .eq('id', message_id);

      if (updateError) {
        console.error("Failed to update message:", updateError);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      ...result 
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Categorization error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function categorizeMessage(apiKey: string, content: string, sender?: string): Promise<{ category: string; confidence: number }> {
  const systemPrompt = `You are an SMS message classifier. Analyze the message and classify it into exactly one category.

Categories:
- otp: One-time passwords, verification codes, 2FA codes
- marketing: Promotional content, sales, discounts, advertisements
- personal: Personal messages from individuals (friends, family)
- transactional: Order confirmations, receipts, shipping updates, bank transactions
- notification: System alerts, reminders, appointment notifications, account updates
- spam: Unsolicited junk, scams, phishing attempts
- unknown: Cannot be confidently classified

Respond with the category name and confidence score (0.0-1.0).`;

  const userPrompt = `Classify this SMS message:
${sender ? `From: ${sender}` : ''}
Message: "${content}"`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "classify_sms",
            description: "Classify an SMS message into a category",
            parameters: {
              type: "object",
              properties: {
                category: { 
                  type: "string", 
                  enum: ["otp", "marketing", "personal", "transactional", "notification", "spam", "unknown"],
                  description: "The category of the SMS message"
                },
                confidence: { 
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                  description: "Confidence score between 0 and 1"
                }
              },
              required: ["category", "confidence"],
              additionalProperties: false
            }
          }
        }
      ],
      tool_choice: { type: "function", function: { name: "classify_sms" } }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("AI gateway error:", response.status, errorText);
    
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    if (response.status === 402) {
      throw new Error("AI credits exhausted. Please add funds to continue.");
    }
    throw new Error(`AI gateway error: ${response.status}`);
  }

  const data = await response.json();
  
  // Extract tool call result
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    const args = JSON.parse(toolCall.function.arguments);
    return {
      category: args.category || "unknown",
      confidence: Math.min(1, Math.max(0, args.confidence || 0.5))
    };
  }

  // Fallback parsing if tool call fails
  return { category: "unknown", confidence: 0.5 };
}
