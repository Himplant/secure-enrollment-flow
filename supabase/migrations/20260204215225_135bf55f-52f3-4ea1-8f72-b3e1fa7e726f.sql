-- Create policies table for managing different payment policies
CREATE TABLE public.policies (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    terms_url TEXT NOT NULL,
    privacy_url TEXT NOT NULL,
    version TEXT NOT NULL,
    terms_content_sha256 TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

-- RLS policies - admins only
CREATE POLICY "Admins can view policies" ON public.policies
FOR SELECT USING (is_admin(auth.uid()));

CREATE POLICY "Admins can insert policies" ON public.policies
FOR INSERT WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins can update policies" ON public.policies
FOR UPDATE USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete policies" ON public.policies
FOR DELETE USING (is_admin(auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_policies_updated_at
BEFORE UPDATE ON public.policies
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add policy_id to enrollments
ALTER TABLE public.enrollments ADD COLUMN policy_id UUID REFERENCES public.policies(id);

-- Create index for faster lookups
CREATE INDEX idx_enrollments_policy_id ON public.enrollments(policy_id);
CREATE INDEX idx_policies_is_default ON public.policies(is_default) WHERE is_default = true;
CREATE INDEX idx_policies_is_active ON public.policies(is_active) WHERE is_active = true;

-- Function to ensure only one default policy
CREATE OR REPLACE FUNCTION public.ensure_single_default_policy()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_default = true THEN
        UPDATE public.policies SET is_default = false WHERE id != NEW.id AND is_default = true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER ensure_single_default_policy_trigger
BEFORE INSERT OR UPDATE ON public.policies
FOR EACH ROW
WHEN (NEW.is_default = true)
EXECUTE FUNCTION public.ensure_single_default_policy();