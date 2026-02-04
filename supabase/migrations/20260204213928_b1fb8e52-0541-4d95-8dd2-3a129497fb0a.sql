-- Add unique constraint on phone for patients table
CREATE UNIQUE INDEX idx_patients_phone_unique ON public.patients (phone) WHERE phone IS NOT NULL;