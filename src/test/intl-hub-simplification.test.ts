import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("admin top-level tabs", () => {
  const dashboard = read("src/pages/AdminDashboard.tsx");

  it("has exactly one top-level International tab", () => {
    const triggers = dashboard.match(/<TabsTrigger value="intl-[^"]+"/g) ?? [];
    expect(triggers).toEqual(['<TabsTrigger value="intl-consultations"']);
  });

  it("no longer renders the separate International Setup tab", () => {
    expect(dashboard).not.toContain("International Setup");
    expect(dashboard).not.toContain("IntlSetupTab");
    expect(existsSync(join(process.cwd(), "src/components/admin/intl/setup/IntlSetupTab.tsx"))).toBe(false);
  });

  it("keeps every U.S. tab untouched", () => {
    for (const t of ["patients", "transactions", "policies", "surgeons", "credits", "credit-economics", "audit"]) {
      expect(dashboard).toContain(`<TabsTrigger value="${t}"`);
    }
  });
});

describe("InternationalHub", () => {
  const hub = read("src/components/admin/intl/InternationalHub.tsx");

  it("exposes the five primary sections and defaults to Overview", () => {
    for (const v of ["overview", "consultations", "network", "access", "advanced"]) {
      expect(hub).toContain(`<TabsTrigger value="${v}">`);
    }
    expect(hub).toContain('useState("overview")');
  });

  it("syncs through the existing sync-surgeons function", () => {
    expect(hub).toContain('supabase.functions.invoke("sync-surgeons"');
  });

  it("only lets super admins mutate the network", () => {
    expect(hub).toContain('adminRole === "super_admin"');
  });
});

describe("network screen", () => {
  const network = read("src/components/admin/intl/hub/NetworkSection.tsx");
  const hook = read("src/components/admin/intl/hub/useIntlNetwork.ts");

  it("shows country as CRM-synced and read-only", () => {
    expect(network).toContain("From Zoho");
    expect(network).toContain("Needs CRM country");
    expect(network).not.toMatch(/onValueChange=\{\(v\) => .*country/);
  });

  it("assigns a distributor inline from the surgeon row", () => {
    expect(network).toContain("changeDistributor");
    expect(network).toContain("Unassigned");
  });

  it("routes every mutation through the admin network edge function", () => {
    expect(hook).toContain('supabase.functions.invoke("intl-admin-network"');
    expect(network).not.toContain('from("distributor_surgeons")');
    expect(network).not.toContain('from("distributors")');
  });
});

describe("intl-admin-network edge function", () => {
  const fn = read("supabase/functions/intl-admin-network/index.ts");

  it("requires a Himplant super admin with MFA", () => {
    expect(fn).toContain("requireAdmin");
    expect(fn).toContain("requireAal2: true");
    expect(fn).toContain("super_admin");
  });

  it("assigns with an atomic upsert keyed by surgeon_id", () => {
    expect(fn).toContain('from("distributor_surgeons")');
    expect(fn).toMatch(/\.upsert\(/);
    expect(fn).toContain('onConflict: "surgeon_id"');
    // The old delete-then-insert path must be gone.
    expect(fn).not.toMatch(/\.delete\(\)[\s\S]{0,200}\.insert\(\{\s*surgeon_id/);
  });

  it("only deletes the mapping on an explicit unassign", () => {
    const assignBlock = fn.slice(
      fn.indexOf('action === "assign_surgeon_distributor"'),
      fn.indexOf('action === "save_distributor"'),
    );
    expect(assignBlock).toMatch(/Explicit unassign/);
    expect(assignBlock).toMatch(/\.delete\(\)\s*\n\s*\.eq\("surgeon_id"/);
  });

  it("audits mutations", () => {
    expect(fn).toContain("admin_audit_log");
  });

  it("never touches protected U.S. tables", () => {
    for (const t of ["enrollments", "surgeon_credits", "processed_stripe_events", "policies\""]) {
      expect(fn).not.toContain(`from("${t}`);
    }
  });
});

describe("friendly portal access levels", () => {
  const access = read("src/components/admin/intl/hub/PortalAccessSection.tsx");

  it("prefills a known contact into the invite dialog", () => {
    expect(access).toContain("email?: string | null");
    expect(access).toContain('email: (inviteTarget.email ?? "").trim()');
    expect(access).toContain('full_name: (inviteTarget.fullName ?? "").trim()');
    const net = read("src/components/admin/intl/hub/NetworkSection.tsx");
    expect(net).toContain("onInvite({ orgType: \"distributor\", orgId: newId!, email");
    expect(net).toContain("email: d.primary_contact_email ?? null");
  });

  it("invites through the existing identity lifecycle", () => {
    expect(access).toContain('supabase.functions.invoke("intl-portal-identity"');
    expect(access).toContain("toRoleCode(form.org_type, form.level)");
  });

  it("never shows raw role codes", () => {
    expect(access).not.toContain("surgeon_admin");
    expect(access).not.toContain("distributor_staff");
  });
});

describe("distributor data minimisation", () => {
  const fn = read("supabase/functions/intl-portal-consultations/index.ts");

  it("masks the patient and strips contact details for distributors", () => {
    expect(fn).toContain("scrubPatient");
    expect(fn).toContain("email: null, phone: null");
    expect(fn).toContain("maskName");
  });

  it("hides outcome notes, patient notes and raw event payloads", () => {
    expect(fn).toContain("outcome_notes: null");
    expect(fn).toContain('"full_name, preferred_language"');
    expect(fn).toContain("{ event_type: e.event_type, created_at: e.created_at }");
  });

  it("still scopes every query to the caller's surgeons", () => {
    expect(fn).toContain('.in("surgeon_id", auth.surgeonIds)');
    expect(fn).toContain("applyWorkspace");
  });
});

describe("portal header", () => {
  const layout = read("src/components/portal/PortalLayout.tsx");

  it("shows organisation plus a friendly role label and scope note", () => {
    expect(layout).toContain("friendlyRoleLabel");
    expect(layout).toContain("Showing only");
  });
});
