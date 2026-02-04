-- Create surgeons table to store surgeons synced from Zoho
CREATE TABLE public.surgeons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  zoho_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  specialty TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add surgeon_id to patients table
ALTER TABLE public.patients ADD COLUMN surgeon_id UUID REFERENCES public.surgeons(id);

-- Enable RLS on surgeons
ALTER TABLE public.surgeons ENABLE ROW LEVEL SECURITY;

-- RLS policies for surgeons table - admins only
CREATE POLICY "Admins can view surgeons" ON public.surgeons
  FOR SELECT USING (is_admin(auth.uid()));

CREATE POLICY "Admins can insert surgeons" ON public.surgeons
  FOR INSERT WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins can update surgeons" ON public.surgeons
  FOR UPDATE USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete surgeons" ON public.surgeons
  FOR DELETE USING (is_admin(auth.uid()));

-- Create index for faster surgeon lookups
CREATE INDEX idx_surgeons_zoho_id ON public.surgeons(zoho_id);
CREATE INDEX idx_patients_surgeon_id ON public.patients(surgeon_id);

-- Add trigger for updated_at on surgeons
CREATE TRIGGER update_surgeons_updated_at
  BEFORE UPDATE ON public.surgeons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();