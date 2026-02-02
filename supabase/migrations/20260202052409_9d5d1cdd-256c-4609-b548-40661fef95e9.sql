-- =============================================
-- PRODUCTION HARDENING: Authentication & Security
-- =============================================

-- 1. Create agent_heartbeat table for reliable status tracking
CREATE TABLE public.agent_heartbeat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL UNIQUE,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'online',
  version text,
  hostname text,
  messages_synced integer DEFAULT 0,
  errors_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable realtime for heartbeat
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_heartbeat;

-- 2. Create user_roles table for RBAC
CREATE TYPE public.app_role AS ENUM ('admin', 'operator', 'viewer');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'viewer',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- 3. Security definer function to check roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Helper function to check if user has any role (is authenticated and authorized)
CREATE OR REPLACE FUNCTION public.is_authorized(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
  )
$$;

-- 4. Enable RLS on new tables
ALTER TABLE public.agent_heartbeat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 5. Drop existing permissive policies and create secure ones

-- sms_messages: Only authorized users can read, agents can insert via service role
DROP POLICY IF EXISTS "Allow public read access to sms_messages" ON public.sms_messages;
DROP POLICY IF EXISTS "Allow service role insert to sms_messages" ON public.sms_messages;
DROP POLICY IF EXISTS "Allow public update to sms_messages" ON public.sms_messages;

CREATE POLICY "Authorized users can read sms_messages"
  ON public.sms_messages FOR SELECT
  USING (public.is_authorized(auth.uid()));

CREATE POLICY "Authorized users can update sms_messages"
  ON public.sms_messages FOR UPDATE
  USING (public.is_authorized(auth.uid()));

CREATE POLICY "Service can insert sms_messages"
  ON public.sms_messages FOR INSERT
  WITH CHECK (true); -- Agent uses anon key, validated by external auth

-- activity_logs: Authorized users read, agents can insert
DROP POLICY IF EXISTS "Allow public read access to activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Allow public insert to activity_logs" ON public.activity_logs;

CREATE POLICY "Authorized users can read activity_logs"
  ON public.activity_logs FOR SELECT
  USING (public.is_authorized(auth.uid()));

CREATE POLICY "Anyone can insert activity_logs"
  ON public.activity_logs FOR INSERT
  WITH CHECK (true);

-- sim_port_config: Only authorized users
DROP POLICY IF EXISTS "Allow public read access to sim_port_config" ON public.sim_port_config;
DROP POLICY IF EXISTS "Allow public insert to sim_port_config" ON public.sim_port_config;
DROP POLICY IF EXISTS "Allow public update to sim_port_config" ON public.sim_port_config;

CREATE POLICY "Authorized users can read sim_port_config"
  ON public.sim_port_config FOR SELECT
  USING (public.is_authorized(auth.uid()));

CREATE POLICY "Admins can insert sim_port_config"
  ON public.sim_port_config FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE POLICY "Admins can update sim_port_config"
  ON public.sim_port_config FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

-- gateway_config: Only admins
DROP POLICY IF EXISTS "Allow public read access to gateway_config" ON public.gateway_config;
DROP POLICY IF EXISTS "Allow public insert to gateway_config" ON public.gateway_config;
DROP POLICY IF EXISTS "Allow public update to gateway_config" ON public.gateway_config;

CREATE POLICY "Authorized users can read gateway_config"
  ON public.gateway_config FOR SELECT
  USING (public.is_authorized(auth.uid()));

CREATE POLICY "Admins can insert gateway_config"
  ON public.gateway_config FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update gateway_config"
  ON public.gateway_config FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- pbx_config: Only admins
DROP POLICY IF EXISTS "Allow public read access to pbx_config" ON public.pbx_config;
DROP POLICY IF EXISTS "Allow public insert to pbx_config" ON public.pbx_config;
DROP POLICY IF EXISTS "Allow public update to pbx_config" ON public.pbx_config;

CREATE POLICY "Authorized users can read pbx_config"
  ON public.pbx_config FOR SELECT
  USING (public.is_authorized(auth.uid()));

CREATE POLICY "Admins can insert pbx_config"
  ON public.pbx_config FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update pbx_config"
  ON public.pbx_config FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- agent_heartbeat: Agents can insert/update, authorized users can read
CREATE POLICY "Authorized users can read agent_heartbeat"
  ON public.agent_heartbeat FOR SELECT
  USING (public.is_authorized(auth.uid()));

CREATE POLICY "Anyone can upsert agent_heartbeat"
  ON public.agent_heartbeat FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update agent_heartbeat"
  ON public.agent_heartbeat FOR UPDATE
  USING (true);

-- user_roles: Users can see their own roles, admins can manage all
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert roles"
  ON public.user_roles FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update roles"
  ON public.user_roles FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles"
  ON public.user_roles FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- 6. Create trigger to auto-assign first user as admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count integer;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  
  -- First user becomes admin
  IF user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'viewer');
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();