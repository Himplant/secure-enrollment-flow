
CREATE POLICY "Admins can read consent documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'consent-documents' AND public.is_admin(auth.uid()));
