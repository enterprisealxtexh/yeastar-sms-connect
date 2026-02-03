-- Create enum for SMS categories
CREATE TYPE public.sms_category AS ENUM (
  'otp',
  'marketing',
  'personal',
  'transactional',
  'notification',
  'spam',
  'unknown'
);

-- Add category column to sms_messages table
ALTER TABLE public.sms_messages 
ADD COLUMN category public.sms_category DEFAULT 'unknown';

-- Add confidence score for AI categorization
ALTER TABLE public.sms_messages 
ADD COLUMN category_confidence numeric(3,2) DEFAULT NULL;

-- Add index for faster category filtering
CREATE INDEX idx_sms_messages_category ON public.sms_messages(category);