
-- Add consent PDF path and signature data to enrollments
ALTER TABLE public.enrollments 
ADD COLUMN consent_pdf_path text,
ADD COLUMN signature_data text;

-- Create storage bucket for consent documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('consent-documents', 'consent-documents', false);

-- Only service role (edge functions) can manage consent documents
CREATE POLICY "Service role manages consent documents"
ON storage.objects FOR ALL
USING (bucket_id = 'consent-documents')
WITH CHECK (bucket_id = 'consent-documents');

-- Admins can view consent documents
CREATE POLICY "Admins can view consent documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'consent-documents' AND public.is_admin(auth.uid()));
