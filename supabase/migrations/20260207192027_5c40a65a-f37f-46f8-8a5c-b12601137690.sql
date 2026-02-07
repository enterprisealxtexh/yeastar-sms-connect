
-- Create AI recommendations table to track all AI-generated suggestions and auto-applied actions
CREATE TABLE public.ai_recommendations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL, -- 'sim_config', 'contact', 'action', 'performance', 'resource'
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'applied', 'dismissed', 'failed'
  auto_applied BOOLEAN DEFAULT false,
  applied_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/update recommendations
CREATE POLICY "Authenticated users can view recommendations"
  ON public.ai_recommendations FOR SELECT
  USING (public.is_authorized(auth.uid()));

CREATE POLICY "Authenticated users can update recommendations"
  ON public.ai_recommendations FOR UPDATE
  USING (public.is_authorized(auth.uid()));

CREATE POLICY "Service role can insert recommendations"
  ON public.ai_recommendations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete recommendations"
  ON public.ai_recommendations FOR DELETE
  USING (public.is_authorized(auth.uid()));

-- Add updated_at trigger
CREATE TRIGGER update_ai_recommendations_updated_at
  BEFORE UPDATE ON public.ai_recommendations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for AI recommendations
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_recommendations;
