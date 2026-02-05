-- Create call_queue table for click-to-call requests
CREATE TABLE public.call_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_extension TEXT NOT NULL,
  to_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,
  requested_by UUID,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  picked_up_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  result TEXT,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.call_queue ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authorized users can read call_queue" 
ON public.call_queue 
FOR SELECT 
USING (is_authorized(auth.uid()));

CREATE POLICY "Authorized users can insert call_queue" 
ON public.call_queue 
FOR INSERT 
WITH CHECK (is_authorized(auth.uid()));

CREATE POLICY "Service can update call_queue" 
ON public.call_queue 
FOR UPDATE 
USING (true);

CREATE POLICY "Service can delete call_queue" 
ON public.call_queue 
FOR DELETE 
USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_queue;

-- Create index for pending calls
CREATE INDEX idx_call_queue_pending ON public.call_queue (status, priority DESC, requested_at ASC) WHERE status = 'pending';

-- Trigger for updated_at
CREATE TRIGGER update_call_queue_updated_at
BEFORE UPDATE ON public.call_queue
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();