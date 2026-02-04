-- Add text content columns to policies table
ALTER TABLE public.policies 
ADD COLUMN terms_text TEXT,
ADD COLUMN privacy_text TEXT;