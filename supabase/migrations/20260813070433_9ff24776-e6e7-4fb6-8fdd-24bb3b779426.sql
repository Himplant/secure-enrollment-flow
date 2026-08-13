-- 1. Portal users must read international data only through the edge functions.
DROP POLICY IF EXISTS "Portal reads in-scope consultations" ON public.consultations;
DROP POLICY IF EXISTS "Portal reads in-scope consultation patients" ON public.consultation_patients;
DROP POLICY IF EXISTS "Portal reads in-scope consultation events" ON public.consultation_events;
DROP POLICY IF EXISTS "Portal reads in-scope policy snapshots" ON public.consultation_policy_snapshots;
DROP POLICY IF EXISTS "Portal reads in-scope consultation tasks" ON public.consultation_tasks;

-- 2. QA fixture registry (international QA only).
CREATE TABLE IF NOT EXISTS public.intl_qa_fixture_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_set_id text NOT NULL,
  table_name text NOT NULL,
  record_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, record_id)
);

GRANT SELECT ON public.intl_qa_fixture_records TO authenticated;
GRANT ALL ON public.intl_qa_fixture_records TO service_role;

ALTER TABLE public.intl_qa_fixture_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read qa fixture records"
  ON public.intl_qa_fixture_records FOR SELECT TO authenticated
  USING (private.is_admin(auth.uid()));

CREATE POLICY "Deny qa fixture writes from clients"
  ON public.intl_qa_fixture_records FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS intl_qa_fixture_records_set_idx
  ON public.intl_qa_fixture_records (fixture_set_id);
