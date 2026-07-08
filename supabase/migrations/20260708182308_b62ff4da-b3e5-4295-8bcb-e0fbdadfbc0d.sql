
-- Add stable consultant identifiers to enrollments
ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS owner_zoho_id text,
  ADD COLUMN IF NOT EXISTS owner_email text;

CREATE INDEX IF NOT EXISTS idx_enrollments_owner_zoho_id ON public.enrollments(owner_zoho_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_owner_email ON public.enrollments(owner_email);

-- Backfill: Kyle Kruger and Kyle Himplant are the same Zoho user (name changed).
UPDATE public.enrollments
SET owner_name = 'Kyle Himplant'
WHERE owner_name = 'Kyle Kruger';

-- Normalize surgeon_credits.consultant_email — some rows contain a display name
-- rather than an email, which duplicates consultants in the UI.
UPDATE public.surgeon_credits SET consultant_email = 'kyle@himplant.com'
  WHERE lower(trim(consultant_email)) IN ('kyle himplant', 'kyle kruger', 'kylekruger418@gmail.com');
UPDATE public.surgeon_credits SET consultant_email = 'justin@himplant.com'
  WHERE lower(trim(consultant_email)) = 'justin goddard';
UPDATE public.surgeon_credits SET consultant_email = 'ray@himplant.com'
  WHERE lower(trim(consultant_email)) = 'ray himplant';
UPDATE public.surgeon_credits SET consultant_email = 'siam@himplant.com'
  WHERE lower(trim(consultant_email)) = 'siam quintero';
