
-- Create credit_status enum
CREATE TYPE public.credit_status AS ENUM ('pending', 'earned', 'forfeited', 'issued');

-- Create credit_source enum
CREATE TYPE public.credit_source AS ENUM ('zoho', 'import');

-- Create surgeon_credits table
CREATE TABLE public.surgeon_credits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  surgeon_id UUID REFERENCES public.surgeons(id) ON DELETE SET NULL,
  surgeon_name TEXT NOT NULL,
  patient_name TEXT NOT NULL,
  patient_email TEXT,
  consultant_email TEXT,
  enrollment_date DATE,
  surgery_date DATE,
  stage TEXT,
  credit_750_expires DATE,
  credit_500_expires DATE,
  credit_amount INTEGER NOT NULL DEFAULT 0,
  credit_status public.credit_status NOT NULL DEFAULT 'pending',
  issued_at TIMESTAMP WITH TIME ZONE,
  issued_by TEXT,
  zoho_deal_id TEXT,
  source public.credit_source NOT NULL DEFAULT 'zoho',
  enrollment_id UUID REFERENCES public.enrollments(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint for dedup
CREATE UNIQUE INDEX idx_surgeon_credits_zoho_deal ON public.surgeon_credits(zoho_deal_id) WHERE zoho_deal_id IS NOT NULL;

-- Index for common queries
CREATE INDEX idx_surgeon_credits_surgeon ON public.surgeon_credits(surgeon_id);
CREATE INDEX idx_surgeon_credits_status ON public.surgeon_credits(credit_status);

-- Enable RLS
ALTER TABLE public.surgeon_credits ENABLE ROW LEVEL SECURITY;

-- RLS policies - admin only
CREATE POLICY "Admins can view surgeon_credits"
  ON public.surgeon_credits FOR SELECT
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins can insert surgeon_credits"
  ON public.surgeon_credits FOR INSERT
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins can update surgeon_credits"
  ON public.surgeon_credits FOR UPDATE
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete surgeon_credits"
  ON public.surgeon_credits FOR DELETE
  USING (is_admin(auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_surgeon_credits_updated_at
  BEFORE UPDATE ON public.surgeon_credits
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
