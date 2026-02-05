-- Create agent_config table for AI-tuned settings
CREATE TABLE public.agent_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  config_key TEXT NOT NULL UNIQUE,
  config_value JSONB NOT NULL,
  ai_tuned BOOLEAN DEFAULT false,
  last_tuned_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create sms_category_feedback table for AI learning
CREATE TABLE public.sms_category_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sms_id UUID NOT NULL,
  original_category TEXT NOT NULL,
  corrected_category TEXT NOT NULL,
  corrected_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create error_logs table for AI diagnostics
CREATE TABLE public.error_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id TEXT,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_context JSONB,
  auto_fix_attempted BOOLEAN DEFAULT false,
  auto_fix_result TEXT,
  ai_diagnosis TEXT,
  ai_suggested_fix TEXT,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create agent_updates table for version tracking
CREATE TABLE public.agent_updates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  release_notes TEXT,
  download_url TEXT,
  is_critical BOOLEAN DEFAULT false,
  released_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.agent_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_category_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_updates ENABLE ROW LEVEL SECURITY;

-- RLS policies for authorized users only
CREATE POLICY "Authorized users can view agent config" ON public.agent_config
  FOR SELECT USING (public.is_authorized(auth.uid()));
  
CREATE POLICY "Authorized users can modify agent config" ON public.agent_config
  FOR ALL USING (public.is_authorized(auth.uid()));

CREATE POLICY "Authorized users can view feedback" ON public.sms_category_feedback
  FOR SELECT USING (public.is_authorized(auth.uid()));

CREATE POLICY "Authorized users can add feedback" ON public.sms_category_feedback
  FOR INSERT WITH CHECK (public.is_authorized(auth.uid()));

CREATE POLICY "Authorized users can view error logs" ON public.error_logs
  FOR SELECT USING (public.is_authorized(auth.uid()));

CREATE POLICY "Public error log insert for agent" ON public.error_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can view agent updates" ON public.agent_updates
  FOR SELECT USING (true);

-- Allow agent to insert/update config without auth (for auto-tuning)
CREATE POLICY "Agent can upsert config" ON public.agent_config
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Agent can update config" ON public.agent_config
  FOR UPDATE USING (true);

-- Insert default agent config values
INSERT INTO public.agent_config (config_key, config_value) VALUES
  ('poll_interval', '{"value": 30000, "min": 5000, "max": 120000}'::jsonb),
  ('heartbeat_interval', '{"value": 60000, "min": 30000, "max": 300000}'::jsonb),
  ('cdr_poll_interval', '{"value": 60000, "min": 30000, "max": 300000}'::jsonb),
  ('retry_backoff_multiplier', '{"value": 2, "min": 1.5, "max": 4}'::jsonb),
  ('max_retries', '{"value": 3, "min": 1, "max": 10}'::jsonb),
  ('auto_restart_on_crash', '{"enabled": true}'::jsonb);

-- Create trigger for updated_at
CREATE TRIGGER update_agent_config_updated_at
  BEFORE UPDATE ON public.agent_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for error_logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.error_logs;