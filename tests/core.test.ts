import { describe, expect, it } from "vitest";
import { canTransitionAppointment } from "../src/lib/appointments/transitions";
import { rangesOverlap } from "../src/lib/appointments/conflicts";
import { calculateLedgerTotals } from "../src/lib/finance/ledger";
import { remainingPaymentBalance } from "../src/lib/finance/payments";
import { calculateOccupancy, calculatePayroll } from "../src/lib/finance/payroll";
import { calculateContributionMargin, calculateOperatingProfit, calculatePlanCompletion, calculateStockBalance } from "../src/lib/finance/business";
import { hasPermission } from "../src/lib/permissions";
import { formatKzPhone, isValidPhone, normalizePhone, toKzE164 } from "../src/lib/validation/phone";
import { reservationStarts } from "../src/lib/appointments/reservations";
import { isStaffTelegramAllowed, resolveTelegramRole } from "../src/lib/auth/bootstrap";

describe("phone normalization", () => {
  it("normalizes Kazakhstan formats consistently", () => {
    const equivalent = [
      "+7 700 123 45 67",
      "+77001234567",
      "7 700 123 45 67",
      "77001234567",
      "8 700 123 45 67",
      "87001234567",
      "700 123 45 67",
      "7001234567",
    ];
    for (const value of equivalent) expect(normalizePhone(value)).toBe("77001234567");
    expect(isValidPhone("+7 700 123 45 67")).toBe(true);
    expect(formatKzPhone("87001234567")).toBe("+7 700 123 45 67");
    expect(toKzE164("7001234567")).toBe("+77001234567");
  });

  it("rejects incomplete and overlong Kazakhstan numbers", () => {
    expect(normalizePhone("+7 700 123")).toBe("700123");
    expect(isValidPhone("+7 700 123")).toBe(false);
    expect(isValidPhone("+7 700 123 45 678")).toBe(false);
  });
});

describe("permissions and status transitions", () => {
  it("never bootstraps an allowlisted unknown user as staff", () => {
    expect(resolveTelegramRole(undefined, "123", "999")).toBe("CLIENT");
    expect(resolveTelegramRole(undefined, "999", "999")).toBe("OWNER");
    expect(isStaffTelegramAllowed("OWNER", "123", ["123"], "999")).toBe(true);
    expect(isStaffTelegramAllowed("OWNER", "456", ["123"], "999")).toBe(false);
  });

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

describe("booking integrity", () => {
  it("reserves every 15-minute bucket touched by a service", () => {
    expect(reservationStarts("2026-08-10T09:05:00.000Z", "2026-08-10T10:00:00.000Z")).toEqual([
      "2026-08-10T09:00:00.000Z",
      "2026-08-10T09:15:00.000Z",
      "2026-08-10T09:30:00.000Z",
      "2026-08-10T09:45:00.000Z",
    ]);
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

describe("business OS calculations", () => {
  it("calculates contribution margin from net collected revenue", () => {
    expect(calculateContributionMargin({ revenue: "100000", refunds: "5000", consumables: "12000", commission: "25000" })).toBe("58000.00");
  });

  it("calculates operating profit without floating point drift", () => {
    expect(calculateOperatingProfit({ netRevenue: "100000.10", payroll: "30000.05", rent: "10000", utilities: "1234.56", consumables: "456.78", otherExpenses: "789.11" })).toBe("57519.60");
  });

  it("calculates stock balance only from movements", () => {
    expect(calculateStockBalance([{ direction: "IN", quantity: "10.5" }, { direction: "OUT", quantity: 2 }, { direction: "IN", quantity: 1.25 }])).toBe("9.750");
  });

  it("caps plan completion at 100 percent", () => {
    expect(calculatePlanCompletion(100000, 125000)).toBe(100);
    expect(calculatePlanCompletion(0, 125000)).toBe(0);
  });
});
