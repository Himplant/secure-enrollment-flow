// Shared consultant normalization.
// Zoho CRM is the source of truth for consultant identity and display name.
// We build a stable key per row (Zoho owner id > owner email > lowercased name)
// and resolve the latest name seen for that key so a CRM rename never surfaces
// as a duplicate. NO hardcoded name mappings — trust whatever Zoho stores.

export type ConsultantSource = {
  owner_name?: string | null;
  owner_email?: string | null;
  owner_zoho_id?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
};

export function getConsultantKey(e: ConsultantSource): string | null {
  if (e.owner_zoho_id) return `zid:${e.owner_zoho_id}`;
  if (e.owner_email) return `em:${String(e.owner_email).toLowerCase().trim()}`;
  if (e.owner_name) return `nm:${String(e.owner_name).toLowerCase().trim()}`;
  return null;
}

// Build a map: stable consultant key -> most-recently-seen owner name.
export function buildConsultantLatestNameMap<T extends ConsultantSource>(
  rows: T[],
): Map<string, string> {
  const latest = new Map<string, { name: string; ts: number }>();
  for (const e of rows) {
    const key = getConsultantKey(e);
    if (!key || !e.owner_name) continue;
    const ts = new Date(e.paid_at || e.created_at || 0).getTime();
    const prev = latest.get(key);
    if (!prev || ts >= prev.ts) latest.set(key, { name: e.owner_name, ts });
  }
  const out = new Map<string, string>();
  for (const [k, v] of latest) out.set(k, v.name);
  return out;
}

// Resolve the canonical display name for a row given a latest-name map.
export function resolveConsultantName(
  row: ConsultantSource,
  latest: Map<string, string>,
): string | null {
  const key = getConsultantKey(row);
  if (key) {
    const name = latest.get(key);
    if (name) return name;
    if (key.startsWith("em:")) {
      const prefix = key.slice(3).split("@")[0];
      return prefix.charAt(0).toUpperCase() + prefix.slice(1);
    }
  }
  return row.owner_name || null;
}
