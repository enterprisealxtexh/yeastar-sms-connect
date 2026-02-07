
-- Function to send new SMS to Telegram via edge function
CREATE OR REPLACE FUNCTION public.notify_telegram_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  payload jsonb;
  edge_url text;
  anon_key text;
BEGIN
  edge_url := 'https://aougsyziktukjvkmglzb.supabase.co/functions/v1/telegram-realtime';
  anon_key := current_setting('app.settings.anon_key', true);
  
  -- If anon_key not available from settings, we hardcode it (safe - it's a publishable key)
  IF anon_key IS NULL OR anon_key = '' THEN
    anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvdWdzeXppa3R1a2p2a21nbHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNDg5NTYsImV4cCI6MjA4NDkyNDk1Nn0.dcsZwEJXND9xdNA1dR-uHH7r6WylGwL7xVKJSFL_C44';
  END IF;

  payload := jsonb_build_object(
    'type', 'sms',
    'record', jsonb_build_object(
      'id', NEW.id,
      'sender_number', NEW.sender_number,
      'message_content', NEW.message_content,
      'sim_port', NEW.sim_port,
      'category', NEW.category,
      'status', NEW.status,
      'received_at', NEW.received_at,
      'created_at', NEW.created_at
    )
  );

  PERFORM net.http_post(
    url := edge_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := payload
  );

  RETURN NEW;
END;
$$;

-- Function to send new call records to Telegram via edge function
CREATE OR REPLACE FUNCTION public.notify_telegram_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  payload jsonb;
  edge_url text;
  anon_key text;
BEGIN
  edge_url := 'https://aougsyziktukjvkmglzb.supabase.co/functions/v1/telegram-realtime';
  anon_key := current_setting('app.settings.anon_key', true);
  
  IF anon_key IS NULL OR anon_key = '' THEN
    anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvdWdzeXppa3R1a2p2a21nbHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNDg5NTYsImV4cCI6MjA4NDkyNDk1Nn0.dcsZwEJXND9xdNA1dR-uHH7r6WylGwL7xVKJSFL_C44';
  END IF;

  payload := jsonb_build_object(
    'type', 'call',
    'record', jsonb_build_object(
      'id', NEW.id,
      'caller_number', NEW.caller_number,
      'caller_name', NEW.caller_name,
      'callee_number', NEW.callee_number,
      'callee_name', NEW.callee_name,
      'direction', NEW.direction,
      'status', NEW.status,
      'extension', NEW.extension,
      'sim_port', NEW.sim_port,
      'total_duration', NEW.total_duration,
      'start_time', NEW.start_time,
      'created_at', NEW.created_at
    )
  );

  PERFORM net.http_post(
    url := edge_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := payload
  );

  RETURN NEW;
END;
$$;

-- Create triggers on the tables
CREATE TRIGGER telegram_notify_new_sms
  AFTER INSERT ON public.sms_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_telegram_sms();

CREATE TRIGGER telegram_notify_new_call
  AFTER INSERT ON public.call_records
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_telegram_call();
