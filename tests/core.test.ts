import { describe, expect, it } from "vitest";
import { canTransitionAppointment } from "../src/lib/appointments/transitions";
import { rangesOverlap } from "../src/lib/appointments/conflicts";
import { calculateLedgerTotals } from "../src/lib/finance/ledger";
import { remainingPaymentBalance } from "../src/lib/finance/payments";
import { calculateOccupancy, calculatePayroll } from "../src/lib/finance/payroll";
import { hasPermission } from "../src/lib/permissions";
import { isValidPhone, normalizePhone } from "../src/lib/validation/phone";

describe("phone normalization", () => {
  it("normalizes Kazakhstan formats consistently", () => {
    expect(normalizePhone("+7 (700) 123-45-67")).toBe("77001234567");
    expect(normalizePhone("8 700 123 45 67")).toBe("77001234567");
    expect(isValidPhone("+7 700 123 45 67")).toBe(true);
  });
});

describe("permissions and status transitions", () => {
  it("keeps finance restricted to accounting roles", () => {
    expect(hasPermission("OWNER", "finance.write")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "payroll.write")).toBe(true);
    expect(hasPermission("SPECIALIST", "finance.write")).toBe(false);
  });

  it("does not grant CRM permissions to clients or unknown roles", () => {
    expect(hasPermission("CLIENT", "employees.read")).toBe(false);
    expect(hasPermission("UNKNOWN", "employees.read")).toBe(false);
  });

  it("does not reopen completed appointments", () => {
    expect(canTransitionAppointment("SCHEDULED", "CONFIRMED")).toBe(true);
    expect(canTransitionAppointment("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransitionAppointment("COMPLETED", "SCHEDULED")).toBe(false);
    expect(canTransitionAppointment("COMPLETED", "CANCELLED", true)).toBe(true);
  });

  it("detects overlapping appointment intervals", () => {
    expect(rangesOverlap("2026-08-10T10:00:00Z", "2026-08-10T11:30:00Z", "2026-08-10T11:00:00Z", "2026-08-10T12:00:00Z")).toBe(true);
    expect(rangesOverlap("2026-08-10T10:00:00Z", "2026-08-10T11:00:00Z", "2026-08-10T11:00:00Z", "2026-08-10T12:00:00Z")).toBe(false);
  });
});

describe("partial payments", () => {
  it("keeps the outstanding balance after partial payment and refund", () => {
    expect(remainingPaymentBalance(30000, [20000])).toBe(10000);
    expect(remainingPaymentBalance(30000, [30000], [5000])).toBe(5000);
  });
});

describe("decimal payroll", () => {
  it("calculates fixed plus percentage", () => {
    expect(calculatePayroll({ fixedAmount: "100000", revenueBase: "333333.33", revenuePercent: "30" })).toMatchObject({ revenueAmount: "100000.00", totalAmount: "200000.00" });
  });

  it("includes bonuses and subtracts deductions and advances", () => {
    const result = calculatePayroll({ fixedAmount: 100000, revenueBase: 200000, revenuePercent: 10, bonusAmount: 15000, deductionAmount: 5000, advanceAmount: 20000 });
    expect(result.totalAmount).toBe("110000.00");
  });

  it("uses real available minutes for occupancy", () => {
    expect(calculateOccupancy(240, 480)).toBe(50);
    expect(calculateOccupancy(20, 0)).toBe(0);
  });
});

describe("financial ledger", () => {
  it("does not count refunds as positive revenue or planned expenses", () => {
    expect(calculateLedgerTotals([
      { direction: "INCOME", kind: "PAYMENT", amount: 30000 },
      { direction: "INCOME", kind: "REFUND", amount: 5000 },
      { direction: "EXPENSE", kind: "EXPENSE", amount: 10000 },
    ])).toMatchObject({ grossIncome: 30000, refunds: 5000, netIncome: 25000, operatingProfit: 15000 });
  });
});
