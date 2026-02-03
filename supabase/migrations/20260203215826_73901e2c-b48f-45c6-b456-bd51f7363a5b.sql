-- Create enrollment status enum
CREATE TYPE public.enrollment_status AS ENUM (
  'created', 'sent', 'opened', 'processing', 'paid', 'failed', 'expired', 'canceled'
);

-- Create payment method type enum
CREATE TYPE public.payment_method_type AS ENUM ('card', 'ach');

-- Create enrollments table
CREATE TABLE public.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text UNIQUE NOT NULL,
  token_last4 text NOT NULL,
  zoho_module text NOT NULL,
  zoho_record_id text NOT NULL,
  patient_name text,
  patient_email text,
  patient_phone text,
  amount_cents integer NOT NULL,
  currency text DEFAULT 'usd',
  status public.enrollment_status NOT NULL DEFAULT 'created',
  expires_at timestamptz NOT NULL,
  opened_at timestamptz,
  processing_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  expired_at timestamptz,
  
  -- Stripe fields
  stripe_session_id text UNIQUE,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  payment_method_type public.payment_method_type,
  
  -- Legal / consent fields
  terms_version text NOT NULL,
  terms_url text NOT NULL,
  privacy_url text NOT NULL,
  terms_sha256 text NOT NULL,
  terms_accepted_at timestamptz,
  terms_accept_ip text,
  terms_accept_user_agent text,
  
  -- Audit timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for enrollments
CREATE INDEX idx_enrollments_zoho_record_id ON public.enrollments(zoho_record_id);
CREATE INDEX idx_enrollments_status ON public.enrollments(status);
CREATE INDEX idx_enrollments_expires_at ON public.enrollments(expires_at);
CREATE INDEX idx_enrollments_token_hash ON public.enrollments(token_hash);

-- Create enrollment_events table (append-only audit log)
CREATE TABLE public.enrollment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid REFERENCES public.enrollments(id) ON DELETE CASCADE NOT NULL,
  event_type text NOT NULL,
  event_data jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create index for enrollment_events
CREATE INDEX idx_enrollment_events_enrollment_id ON public.enrollment_events(enrollment_id);

-- Create processed_stripe_events table (for idempotency)
CREATE TABLE public.processed_stripe_events (
  stripe_event_id text PRIMARY KEY,
  processed_at timestamptz DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;

-- No public access policies - all access via edge functions with service role key
-- This ensures patient data is protected and only accessed server-side

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for enrollments updated_at
CREATE TRIGGER update_enrollments_updated_at
  BEFORE UPDATE ON public.enrollments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();