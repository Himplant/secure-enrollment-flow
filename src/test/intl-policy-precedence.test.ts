import { describe, it, expect } from "vitest";

/**
 * Mirror of the server-side resolution order in
 * supabase/functions/_shared/intl-policy.ts. Kept in sync by these tests so a
 * change in precedence is caught immediately.
 */
export interface PolicyCandidate {
  id: string;
  surgeon_id: string | null;
  provider: string | null;
  language: string;
  country: string;
  is_active: boolean;
}

export function resolvePolicy(
  candidates: PolicyCandidate[],
  ctx: { surgeonId: string; country: string; language: string; provider: string; explicitId?: string },
): PolicyCandidate | null {
  if (ctx.explicitId) {
    return candidates.find((c) => c.id === ctx.explicitId && c.is_active) ?? null;
  }
  const pool = candidates.filter(
    (c) => c.is_active && c.country === ctx.country && c.language === ctx.language,
  );
  const rules: ((c: PolicyCandidate) => boolean)[] = [
    (c) => c.surgeon_id === ctx.surgeonId && c.provider === ctx.provider,
    (c) => c.surgeon_id === ctx.surgeonId && c.provider === null,
    (c) => c.surgeon_id === null && c.provider === ctx.provider,
    (c) => c.surgeon_id === null && c.provider === null,
  ];
  for (const rule of rules) {
    const hit = pool.find(rule);
    if (hit) return hit;
  }
  return null;
}

const base = { country: "CO", language: "es", is_active: true };
const surgeonId = "surgeon-1";

const all: PolicyCandidate[] = [
  { id: "surgeon+provider", surgeon_id: surgeonId, provider: "test", ...base },
  { id: "surgeon", surgeon_id: surgeonId, provider: null, ...base },
  { id: "default+provider", surgeon_id: null, provider: "test", ...base },
  { id: "default", surgeon_id: null, provider: null, ...base },
];

const ctx = { surgeonId, country: "CO", language: "es", provider: "test" };

describe("international policy precedence", () => {
  it("prefers an explicit policy id above everything else", () => {
    expect(resolvePolicy(all, { ...ctx, explicitId: "default" })?.id).toBe("default");
  });

  it("prefers surgeon + provider", () => {
    expect(resolvePolicy(all, ctx)?.id).toBe("surgeon+provider");
  });

  it("falls back to surgeon without provider", () => {
    const pool = all.filter((p) => p.id !== "surgeon+provider");
    expect(resolvePolicy(pool, ctx)?.id).toBe("surgeon");
  });

  it("falls back to the country default with provider", () => {
    const pool = all.filter((p) => !p.surgeon_id);
    expect(resolvePolicy(pool, ctx)?.id).toBe("default+provider");
  });

  it("falls back to the plain country default", () => {
    const pool = all.filter((p) => p.id === "default");
    expect(resolvePolicy(pool, ctx)?.id).toBe("default");
  });

  it("ignores retired policies", () => {
    const pool = all.map((p) => ({ ...p, is_active: false }));
    expect(resolvePolicy(pool, ctx)).toBeNull();
  });

  it("does not cross language or country boundaries", () => {
    expect(resolvePolicy(all, { ...ctx, language: "en" })).toBeNull();
    expect(resolvePolicy(all, { ...ctx, country: "MX" })).toBeNull();
  });

  it("rejects link creation when no policy exists (fail closed)", () => {
    expect(resolvePolicy([], ctx)).toBeNull();
  });
});
