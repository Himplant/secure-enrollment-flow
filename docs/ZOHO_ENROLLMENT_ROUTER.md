# Zoho: one "Generate Enrollment Link" button

The single Zoho button now calls a router edge function that decides, server-side,
whether the request is a U.S. enrollment or an international consultation.

## Deluge migration (no secrets in this doc)

1. Change the invoke URL only:

   - before: `.../functions/v1/create-enrollment`
   - after: `.../functions/v1/zoho-generate-enrollment-link`

2. Keep the existing auth header / HMAC exactly as-is (same shared-secret
   convention as `create-enrollment`). No credential changes are needed in Deluge.

3. Keep parsing the response the same way:

   ```
   resp.get("enrollment_url")
   resp.get("expires_at")
   ```

4. Remove the hardcoded `"currency": "usd"` line (and any `expires_in_hours`)
   from the button payload. The router already strips both before calling the
   international service, so international flows stay safe even if the line
   remains, but removing it keeps the payload honest.

## Routing rules

- The router refreshes the selected surgeon from Zoho first, then reads the
  fresh `country`.
- `MX`, `CO`, `CL` -> `intl-create-consultation-from-zoho` (international
  service derives country currency, e.g. COP for Colombia, and owns the fixed
  48h expiry).
- Every other country -> the existing, unchanged `create-enrollment`.
- Routing is never based on surgeon name.
- Fail closed: if the surgeon cannot be refreshed, cannot be identified, or is
  inactive, no link is generated.

## Normalized response

```json
{
  "success": true,
  "enrollment_url": "...",
  "expires_at": "...",
  "flow_type": "domestic | international",
  "surgeon_country": "US | CO | ...",
  "enrollment_id": "... (domestic)",
  "consultation_id": "... (international)",
  "provider": "... (when present)",
  "currency": "... (when present)"
}
```

For international results, `enrollment_url` mirrors `consultation_url`.
Errors return `success:false` with a status and message that contain no patient PII.
