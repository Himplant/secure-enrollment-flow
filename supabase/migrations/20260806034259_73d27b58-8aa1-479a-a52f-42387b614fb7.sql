ALTER TABLE public.surgeons
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS is_international boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS surgeons_country_idx ON public.surgeons (country);