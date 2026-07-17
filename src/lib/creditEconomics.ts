// Pure computations for the Credit Economics dashboard.
// Deposit is $500. Credits are either $750 (redeemed within 3 months)
// or $500 (redeemed months 3-6). We lose $250 per $750 redemption.

export const DEPOSIT_CENTS = 50000; // $500
export const OVERPAY_CENTS = 25000; // $250 gap on 3-month credits

export interface EnrollmentRow {
  status: string;
  amount_cents: number;
  paid_at?: string | null;
  patients?: { surgeon_id?: string | null; surgeon?: { id?: string; name?: string | null } | null } | null;
  surgeon_id?: string | null;
  surgeon_name?: string | null;
}

export interface CreditRow {
  surgeon_id: string | null;
  surgeon_name: string | null;
  credit_amount: number;      // dollars
  issued_amount: number;      // dollars
  credit_status: string;      // pending | earned | issued | forfeited | disputed
  patient_email?: string | null;
  consultant_email?: string | null;
  enrollment_date?: string | null;
}

export interface EconomicsTotals {
  collectedCents: number;
  paidOutCents: number;
  earnedOwedCents: number;
  pendingLiabilityCents: number;
  overpayRealizedCents: number;
  overpayPotentialCents: number;
  forfeitedGainCents: number;
  netPositionCents: number;
  paidCount: number;
  refundedCount: number;
  issuedCount: number;
  earnedCount: number;
  pendingCount: number;
  forfeitedCount: number;
}

export interface SurgeonEconomics {
  surgeonId: string | null;
  surgeonName: string;
  enrolledCount: number;
  collectedCents: number;
  paidOutCents: number;
  earnedOwedCents: number;
  pendingLiabilityCents: number;
  overpayRealizedCents: number;
  overpayPotentialCents: number;
  forfeitedGainCents: number;
  netCents: number;
}

const dollarsToCents = (d: number | null | undefined) => Math.round((Number(d) || 0) * 100);

export function computeTotals(enrollments: EnrollmentRow[], credits: CreditRow[]): EconomicsTotals {
  let collectedCents = 0;
  let paidCount = 0;
  let refundedCount = 0;
  for (const e of enrollments) {
    if (e.status === "paid") { collectedCents += e.amount_cents || 0; paidCount++; }
    else if (e.status === "refunded") { collectedCents -= e.amount_cents || 0; refundedCount++; }
  }

  let paidOutCents = 0;
  let earnedOwedCents = 0;
  let pendingLiabilityCents = 0;
  let overpayRealizedCents = 0;
  let overpayPotentialCents = 0;
  let forfeitedGainCents = 0;
  let issuedCount = 0, earnedCount = 0, pendingCount = 0, forfeitedCount = 0;

  for (const c of credits) {
    const amt = dollarsToCents(c.credit_amount);
    const issued = dollarsToCents(c.issued_amount);
    switch (c.credit_status) {
      case "issued":
        paidOutCents += issued;
        issuedCount++;
        if (c.credit_amount === 750) overpayRealizedCents += OVERPAY_CENTS;
        break;
      case "earned":
        earnedOwedCents += amt;
        earnedCount++;
        if (c.credit_amount === 750) overpayRealizedCents += OVERPAY_CENTS;
        break;
      case "pending":
        pendingLiabilityCents += amt;
        pendingCount++;
        if (c.credit_amount === 750) overpayPotentialCents += OVERPAY_CENTS;
        break;
      case "forfeited":
        forfeitedGainCents += DEPOSIT_CENTS;
        forfeitedCount++;
        break;
    }
  }

  const netPositionCents =
    collectedCents - paidOutCents - earnedOwedCents - overpayRealizedCents + forfeitedGainCents;

  return {
    collectedCents, paidOutCents, earnedOwedCents, pendingLiabilityCents,
    overpayRealizedCents, overpayPotentialCents, forfeitedGainCents, netPositionCents,
    paidCount, refundedCount, issuedCount, earnedCount, pendingCount, forfeitedCount,
  };
}

export function computeBySurgeon(
  enrollments: EnrollmentRow[],
  credits: CreditRow[],
): SurgeonEconomics[] {
  const map = new Map<string, SurgeonEconomics>();

  const keyFor = (id: string | null | undefined, name: string | null | undefined) => {
    if (id) return `id:${id}`;
    if (name) return `nm:${name.toLowerCase()}`;
    return "unassigned";
  };

  const ensure = (id: string | null, name: string): SurgeonEconomics => {
    const k = keyFor(id, name);
    let row = map.get(k);
    if (!row) {
      row = {
        surgeonId: id,
        surgeonName: name || "Unassigned",
        enrolledCount: 0,
        collectedCents: 0, paidOutCents: 0, earnedOwedCents: 0,
        pendingLiabilityCents: 0, overpayRealizedCents: 0, overpayPotentialCents: 0,
        forfeitedGainCents: 0, netCents: 0,
      };
      map.set(k, row);
    }
    return row;
  };

  for (const e of enrollments) {
    const sid = e.surgeon_id ?? e.patients?.surgeon_id ?? null;
    const sname = e.surgeon_name ?? e.patients?.surgeon?.name ?? "Unassigned";
    const row = ensure(sid, sname);
    if (e.status === "paid") { row.collectedCents += e.amount_cents || 0; row.enrolledCount++; }
    else if (e.status === "refunded") { row.collectedCents -= e.amount_cents || 0; }
  }

  for (const c of credits) {
    const row = ensure(c.surgeon_id, c.surgeon_name || "Unassigned");
    const amt = dollarsToCents(c.credit_amount);
    const issued = dollarsToCents(c.issued_amount);
    switch (c.credit_status) {
      case "issued":
        row.paidOutCents += issued;
        if (c.credit_amount === 750) row.overpayRealizedCents += OVERPAY_CENTS;
        break;
      case "earned":
        row.earnedOwedCents += amt;
        if (c.credit_amount === 750) row.overpayRealizedCents += OVERPAY_CENTS;
        break;
      case "pending":
        row.pendingLiabilityCents += amt;
        if (c.credit_amount === 750) row.overpayPotentialCents += OVERPAY_CENTS;
        break;
      case "forfeited":
        row.forfeitedGainCents += DEPOSIT_CENTS;
        break;
    }
  }

  for (const row of map.values()) {
    row.netCents =
      row.collectedCents - row.paidOutCents - row.earnedOwedCents
      - row.overpayRealizedCents + row.forfeitedGainCents;
  }

  return Array.from(map.values()).sort((a, b) => b.collectedCents - a.collectedCents);
}

export const fmtCents = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(c / 100);
