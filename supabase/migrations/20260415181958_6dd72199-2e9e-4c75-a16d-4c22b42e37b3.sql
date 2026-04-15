UPDATE surgeon_credits sc
SET surgeon_id = p.surgeon_id,
    surgeon_name = s.name
FROM patients p
JOIN surgeons s ON s.id = p.surgeon_id
WHERE LOWER(TRIM(sc.patient_email)) = LOWER(TRIM(p.email))
  AND sc.surgeon_name = 'Unknown'
  AND p.surgeon_id IS NOT NULL
  AND p.email IS NOT NULL;