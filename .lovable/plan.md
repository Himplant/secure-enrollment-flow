# Reduce scraper/prospecting exposure

## 1. Add `noindex` to the enrollment site

Edit `index.html` `<head>` to add:

```html
<meta name="robots" content="noindex, nofollow" />
```

Also add `public/robots.txt` directives to discourage well-behaved crawlers:

```
User-agent: *
Disallow: /
```

Effect: Google/Bing stop indexing `enroll.himplant.com` and the Lovable preview URL. Existing indexed pages drop off over the next few weeks. Legitimate patients using the direct enrollment link they receive by email are unaffected — the link still works normally.

Caveat: this does not stop determined scrapers (like the one behind the UniPaaS email) that crawl Lovable's published subdomains directly. It only cuts search-engine surface area.

## 2. Zoho mentions in public copy — nothing to do

Verified: "Zoho" only appears in admin-only files (`AdminDashboard.tsx`, `TransactionsTab.tsx`, `SurgeonManagement.tsx`, `consultant.ts`) and generated types. It is not visible on any patient-facing page (`Index.tsx`, `EnrollPage.tsx`, enrollment components). No changes needed.

## Not doing (unless you ask)

- Hiding the "Edit with Lovable" badge — separate publish-setting action, requires your approval.
- Switching payment processors — no reason to based on a cold sales email.
