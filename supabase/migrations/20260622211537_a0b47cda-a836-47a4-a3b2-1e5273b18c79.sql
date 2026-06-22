
WITH dupes AS (
  SELECT lower(patient_email) AS e
  FROM public.surgeon_credits
  WHERE patient_email IS NOT NULL
  GROUP BY 1
  HAVING count(*) > 1
     AND bool_or(zoho_deal_id IS NOT NULL)
     AND bool_or(zoho_deal_id IS NULL)
),
zoho_row AS (
  SELECT DISTINCT ON (lower(sc.patient_email)) sc.id, lower(sc.patient_email) AS e
  FROM public.surgeon_credits sc
  JOIN dupes d ON d.e = lower(sc.patient_email)
  WHERE sc.zoho_deal_id IS NOT NULL
  ORDER BY lower(sc.patient_email), sc.updated_at DESC
),
orphan_row AS (
  SELECT DISTINCT ON (lower(sc.patient_email)) sc.id, lower(sc.patient_email) AS e, sc.enrollment_id
  FROM public.surgeon_credits sc
  JOIN dupes d ON d.e = lower(sc.patient_email)
  WHERE sc.zoho_deal_id IS NULL
  ORDER BY lower(sc.patient_email), sc.created_at ASC
)
UPDATE public.surgeon_credits sc
SET enrollment_id = COALESCE(sc.enrollment_id, o.enrollment_id)
FROM zoho_row z
JOIN orphan_row o ON o.e = z.e
WHERE sc.id = z.id;

WITH dupes AS (
  SELECT lower(patient_email) AS e
  FROM public.surgeon_credits
  WHERE patient_email IS NOT NULL
  GROUP BY 1
  HAVING count(*) > 1
     AND bool_or(zoho_deal_id IS NOT NULL)
     AND bool_or(zoho_deal_id IS NULL)
)
DELETE FROM public.surgeon_credits sc
USING dupes d
WHERE lower(sc.patient_email) = d.e
  AND sc.zoho_deal_id IS NULL;
