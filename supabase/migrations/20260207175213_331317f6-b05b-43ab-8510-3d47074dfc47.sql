
-- Contacts table to auto-save numbers from SMS and call records
CREATE TABLE public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number TEXT NOT NULL UNIQUE,
  name TEXT,
  source TEXT NOT NULL DEFAULT 'auto',
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sms_count INTEGER NOT NULL DEFAULT 0,
  call_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- Policies - authorized users can read, admins/operators can manage
CREATE POLICY "Authorized users can read contacts"
  ON public.contacts FOR SELECT
  USING (is_authorized(auth.uid()));

CREATE POLICY "Service can insert contacts"
  ON public.contacts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service can update contacts"
  ON public.contacts FOR UPDATE
  USING (true);

CREATE POLICY "Authorized users can insert contacts"
  ON public.contacts FOR INSERT
  WITH CHECK (is_authorized(auth.uid()));

CREATE POLICY "Authorized users can update contacts"
  ON public.contacts FOR UPDATE
  USING (is_authorized(auth.uid()));

CREATE POLICY "Admins can delete contacts"
  ON public.contacts FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for fast phone number lookups
CREATE INDEX idx_contacts_phone ON public.contacts (phone_number);

-- Trigger for updated_at
CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to auto-save contact from SMS
CREATE OR REPLACE FUNCTION public.autosave_contact_from_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.contacts (phone_number, source, first_seen_at, last_seen_at, sms_count)
  VALUES (NEW.sender_number, 'sms', NEW.received_at, NEW.received_at, 1)
  ON CONFLICT (phone_number) DO UPDATE SET
    last_seen_at = GREATEST(contacts.last_seen_at, NEW.received_at),
    sms_count = contacts.sms_count + 1,
    updated_at = now();
  RETURN NEW;
END;
$$;

-- Function to auto-save contacts from call records (both caller and callee)
CREATE OR REPLACE FUNCTION public.autosave_contact_from_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Save caller
  IF NEW.caller_number IS NOT NULL AND NEW.caller_number != '' THEN
    INSERT INTO public.contacts (phone_number, name, source, first_seen_at, last_seen_at, call_count)
    VALUES (NEW.caller_number, NEW.caller_name, 'call', NEW.start_time, NEW.start_time, 1)
    ON CONFLICT (phone_number) DO UPDATE SET
      name = COALESCE(NULLIF(EXCLUDED.name, ''), contacts.name),
      last_seen_at = GREATEST(contacts.last_seen_at, NEW.start_time),
      call_count = contacts.call_count + 1,
      updated_at = now();
  END IF;

  -- Save callee
  IF NEW.callee_number IS NOT NULL AND NEW.callee_number != '' THEN
    INSERT INTO public.contacts (phone_number, name, source, first_seen_at, last_seen_at, call_count)
    VALUES (NEW.callee_number, NEW.callee_name, 'call', NEW.start_time, NEW.start_time, 1)
    ON CONFLICT (phone_number) DO UPDATE SET
      name = COALESCE(NULLIF(EXCLUDED.name, ''), contacts.name),
      last_seen_at = GREATEST(contacts.last_seen_at, NEW.start_time),
      call_count = contacts.call_count + 1,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

-- Create triggers
CREATE TRIGGER autosave_contact_on_sms
  AFTER INSERT ON public.sms_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.autosave_contact_from_sms();

CREATE TRIGGER autosave_contact_on_call
  AFTER INSERT ON public.call_records
  FOR EACH ROW
  EXECUTE FUNCTION public.autosave_contact_from_call();
