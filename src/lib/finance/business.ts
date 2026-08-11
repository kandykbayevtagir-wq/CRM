import Decimal from "decimal.js";

export function calculateContributionMargin(input: { revenue: string | number; refunds?: string | number; consumables?: string | number; commission?: string | number }): string {
  const result = new Decimal(input.revenue ?? 0)
    .minus(input.refunds ?? 0)
    .minus(input.consumables ?? 0)
    .minus(input.commission ?? 0);
  return result.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function calculateOperatingProfit(input: { netRevenue: string | number; payroll?: string | number; rent?: string | number; utilities?: string | number; consumables?: string | number; otherExpenses?: string | number }): string {
  const result = new Decimal(input.netRevenue ?? 0)
    .minus(input.payroll ?? 0)
    .minus(input.rent ?? 0)
    .minus(input.utilities ?? 0)
    .minus(input.consumables ?? 0)
    .minus(input.otherExpenses ?? 0);
  return result.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function calculateStockBalance(movements: Array<{ direction: "IN" | "OUT"; quantity: string | number }>): string {
  const result = movements.reduce((total, movement) => movement.direction === "IN" ? total.plus(movement.quantity) : total.minus(movement.quantity), new Decimal(0));
  return result.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
}

export function calculatePlanCompletion(plan: string | number, fact: string | number): number {
  const target = new Decimal(plan ?? 0);
  if (target.lte(0)) return 0;
  return Math.min(100, Number(new Decimal(fact ?? 0).div(target).mul(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString()));
}
