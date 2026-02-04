-- Create patients table for storing unique patient contacts
CREATE TABLE public.patients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add unique constraint on email (when not null)
CREATE UNIQUE INDEX idx_patients_email_unique ON public.patients (email) WHERE email IS NOT NULL;

-- Enable RLS
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

-- RLS policies for patients table
CREATE POLICY "Admins can view patients" 
ON public.patients 
FOR SELECT 
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can insert patients" 
ON public.patients 
FOR INSERT 
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins can update patients" 
ON public.patients 
FOR UPDATE 
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete patients" 
ON public.patients 
FOR DELETE 
USING (is_admin(auth.uid()));

-- Add patient_id column to enrollments to link transactions to patients
ALTER TABLE public.enrollments ADD COLUMN patient_id UUID REFERENCES public.patients(id);

-- Create index for faster lookups
CREATE INDEX idx_enrollments_patient_id ON public.enrollments(patient_id);

-- Add trigger for updated_at
CREATE TRIGGER update_patients_updated_at
BEFORE UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();