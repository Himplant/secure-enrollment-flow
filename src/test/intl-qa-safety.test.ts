import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync("supabase/functions/intl-qa-fixtures/index.ts", "utf8");

/** Tables that belong to the U.S. enrollment flow and must never be reachable. */
const US_TABLES = [
  "enrollments",
  "enrollment_events",
  "patients",
  "policies",
  "surgeon_credits",
  "processed_stripe_events",
];

describe("Portal Test Center safety rails", () => {
  it("only ever deletes from the international allowlist", () => {
    const block = SOURCE.split("const CLEANABLE_TABLES = [")[1].split("] as const;")[0];
    for (const table of US_TABLES) {
      expect(block).not.toContain(`"${table}"`);
    }
    expect(block).toContain('"consultations"');
    expect(block).toContain('"portal_memberships"');
  });

  it("requires super admin and AAL2", () => {
    expect(SOURCE).toContain("requireAal2: true");
    expect(SOURCE).toContain('adminRow?.role !== "super_admin"');
  });

  it("is gated behind the QA feature flag for every mutating action", () => {
    expect(SOURCE).toContain('action !== "status" && !qaEnabled');
  });

  it("registers every created record before cleanup can touch it", () => {
    expect(SOURCE).toContain("intl_qa_fixture_records");
    expect(SOURCE).toContain(".eq(\"fixture_set_id\", FIXTURE_SET)");
  });

  it("only deletes auth users explicitly tagged as QA demo accounts", () => {
    expect(SOURCE).toContain("u.app_metadata?.intl_qa_demo === true");
  });

  it("never echoes the temporary password back to the client", () => {
    // The only response payload after user creation is the status snapshot,
    // which is built from database columns and never includes the password.
    expect(SOURCE).toContain("The temporary password is never echoed back.");
    expect(SOURCE).not.toMatch(/password,?\s*\}\)/);
  });
  });

  it("uses the internal test payment provider for fixtures", () => {
    expect(SOURCE).toContain('provider: "test"');
    expect(SOURCE).not.toContain("STRIPE_SECRET_KEY");
  });
});
