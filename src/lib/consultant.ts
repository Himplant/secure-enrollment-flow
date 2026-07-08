// Shared consultant normalization: map legacy/renamed CRM owner names to a stable
// key (Zoho owner id > owner email > mapped name) and resolve the latest name
// per key so CRM renames never surface as duplicates in the UI.

export const CONSULTANT_NAME_TO_EMAIL: Record<string, string> = {
  "kyle himplant": "kyle@himplant.com",
  "kyle kruger": "kyle@himplant.com", // legacy name for the same Zoho user
  "justin goddard": "justin@himplant.com",
  "ray himplant": "ray@himplant.com",
  "siam quintero": "siam@himplant.com",
};

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
  if (e.owner_name) {
    const normalized = String(e.owner_name).toLowerCase().trim();
    const mapped = CONSULTANT_NAME_TO_EMAIL[normalized];
    if (mapped) return `em:${mapped}`;
    return `nm:${normalized}`;
  }
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
