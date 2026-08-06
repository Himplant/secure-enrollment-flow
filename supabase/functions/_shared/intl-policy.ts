// International policy resolution + immutable snapshots.
//
// Resolution order (fail-closed — no fallback invention):
//   a. explicit policy_id
//   b. surgeon + country + language + provider
//   c. surgeon + country + language
//   d. country default + language + provider
//   e. country default + language
//   f. reject
//
// Nothing here touches the U.S. `policies` table.

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface ResolvedPolicy {
  policy: Record<string, unknown>;
  rule: "explicit" | "surgeon_provider" | "surgeon" | "country_default_provider" | "country_default";
}

export interface PolicyQuery {
  policyId?: string | null;
  surgeonId: string;
  country: string;
  language: string;
  provider: string;
}

const SELECT =
  "id, country, language, provider, surgeon_id, version, terms_text, terms_url, privacy_url, " +
  "content_sha256, cancellation_policy, no_show_policy, refund_exceptions, is_active, is_country_default";

export async function resolveIntlPolicy(admin: Admin, q: PolicyQuery): Promise<ResolvedPolicy | null> {
  if (q.policyId) {
    const { data } = await admin
      .from("international_policies")
      .select(SELECT)
      .eq("id", q.policyId)
      .eq("is_active", true)
      .maybeSingle();
    return data ? { policy: data, rule: "explicit" } : null;
  }

  const base = () =>
    admin
      .from("international_policies")
      .select(SELECT)
      .eq("is_active", true)
      .eq("country", q.country)
      .eq("language", q.language)
      .order("effective_at", { ascending: false })
      .limit(1);

  const attempts: { rule: ResolvedPolicy["rule"]; run: () => Promise<{ data: unknown }> }[] = [
    {
      rule: "surgeon_provider",
      run: () => base().eq("surgeon_id", q.surgeonId).eq("provider", q.provider).maybeSingle(),
    },
    {
      rule: "surgeon",
      run: () => base().eq("surgeon_id", q.surgeonId).is("provider", null).maybeSingle(),
    },
    {
      rule: "country_default_provider",
      run: () => base().is("surgeon_id", null).eq("provider", q.provider).maybeSingle(),
    },
    {
      rule: "country_default",
      run: () => base().is("surgeon_id", null).is("provider", null).maybeSingle(),
    },
  ];

  for (const attempt of attempts) {
    const { data } = await attempt.run();
    if (data) return { policy: data as Record<string, unknown>, rule: attempt.rule };
  }

  return null;
}

export interface SnapshotInput {
  consultationId: string;
  resolved: ResolvedPolicy;
  surgeonId: string;
  country: string;
  language: string;
  provider: string;
  amountMinor: number;
  currency: string;
}

/** Writes the immutable snapshot and links it on the consultation. */
export async function createPolicySnapshot(admin: Admin, input: SnapshotInput): Promise<string> {
  const p = input.resolved.policy as Record<string, string | null>;

  const { data, error } = await admin
    .from("consultation_policy_snapshots")
    .insert({
      consultation_id: input.consultationId,
      policy_id: p.id,
      resolution_rule: input.resolved.rule,
      country: input.country,
      language: input.language,
      provider: input.provider,
      surgeon_id: input.surgeonId,
      amount_minor: input.amountMinor,
      currency: input.currency,
      policy_version: p.version ?? "v1",
      content_sha256: p.content_sha256 ?? "",
      terms_text: p.terms_text ?? "",
      terms_url: p.terms_url,
      privacy_url: p.privacy_url,
      cancellation_policy: p.cancellation_policy,
      no_show_policy: p.no_show_policy,
      refund_exceptions: p.refund_exceptions,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to store policy snapshot: ${error.message}`);

  await admin
    .from("consultations")
    .update({
      policy_snapshot_id: data.id,
      policy_id: p.id,
      terms_version: p.version,
      terms_sha256: p.content_sha256,
    })
    .eq("id", input.consultationId);

  return data.id as string;
}

/** Fail-closed guard used before checkout. */
export async function requirePolicySnapshot(admin: Admin, consultationId: string): Promise<boolean> {
  const { data } = await admin
    .from("consultation_policy_snapshots")
    .select("id")
    .eq("consultation_id", consultationId)
    .limit(1)
    .maybeSingle();
  return !!data;
}
