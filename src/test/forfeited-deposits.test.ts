import { describe, expect, it } from "vitest";
import { summarizeForfeitedDeposits } from "@/lib/creditEconomics";

describe("forfeited enrollment deposits", () => {
  it("reports $500 per forfeited deposit even when expired credits are zero", () => {
    const records = [
      { credit_status: "forfeited", credit_amount: 0 },
      { credit_status: "forfeited", credit_amount: 0 },
      { credit_status: "earned", credit_amount: 750 },
      { credit_status: "pending", credit_amount: 500 },
    ];
    expect(summarizeForfeitedDeposits(records)).toEqual({ count: 2, amountDollars: 1000 });
    expect(records[0].credit_amount).toBe(0);
  });
  it("reports no forfeited deposits when none exist", () => {
    expect(summarizeForfeitedDeposits([])).toEqual({ count: 0, amountDollars: 0 });
  });
});