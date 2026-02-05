-- Create enum for call status
CREATE TYPE public.call_status AS ENUM ('answered', 'missed', 'busy', 'failed', 'voicemail');

-- Create enum for call direction
CREATE TYPE public.call_direction AS ENUM ('inbound', 'outbound', 'internal');

-- Create table for call records (CDR)
CREATE TABLE public.call_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id TEXT UNIQUE,
  caller_number TEXT NOT NULL,
  callee_number TEXT NOT NULL,
  caller_name TEXT,
  callee_name TEXT,
  direction call_direction NOT NULL DEFAULT 'inbound',
  status call_status NOT NULL DEFAULT 'answered',
  sim_port INTEGER,
  extension TEXT,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  answer_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  ring_duration INTEGER DEFAULT 0,
  talk_duration INTEGER DEFAULT 0,
  hold_duration INTEGER DEFAULT 0,
  total_duration INTEGER DEFAULT 0,
  recording_url TEXT,
  transfer_to TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.call_records ENABLE ROW LEVEL SECURITY;

-- Policies: Agent can insert/update, authorized users can read
CREATE POLICY "Service can insert call_records"
ON public.call_records
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service can update call_records"
ON public.call_records
FOR UPDATE
USING (true);

CREATE POLICY "Authorized users can read call_records"
ON public.call_records
FOR SELECT
USING (is_authorized(auth.uid()));

-- Create indexes for performance
CREATE INDEX idx_call_records_start_time ON public.call_records(start_time DESC);
CREATE INDEX idx_call_records_caller ON public.call_records(caller_number);
CREATE INDEX idx_call_records_callee ON public.call_records(callee_number);
CREATE INDEX idx_call_records_status ON public.call_records(status);
CREATE INDEX idx_call_records_sim_port ON public.call_records(sim_port);
CREATE INDEX idx_call_records_extension ON public.call_records(extension);

-- Trigger for updated_at
CREATE TRIGGER update_call_records_updated_at
BEFORE UPDATE ON public.call_records
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for call records
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_records;