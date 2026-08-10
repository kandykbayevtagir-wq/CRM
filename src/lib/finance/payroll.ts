import Decimal from "decimal.js";

export type PayrollCalculationInput = {
  fixedAmount: string | number;
  revenueBase: string | number;
  revenuePercent: string | number;
  bonusAmount?: string | number;
  deductionAmount?: string | number;
  advanceAmount?: string | number;
  manualAdjustmentAmount?: string | number;
};

export type PayrollCalculation = {
  fixedAmount: string;
  revenueBase: string;
  revenueAmount: string;
  bonusAmount: string;
  deductionAmount: string;
  advanceAmount: string;
  manualAdjustmentAmount: string;
  totalAmount: string;
};

function nonNegative(value: string | number | undefined): Decimal {
  const result = new Decimal(value ?? 0);
  if (!result.isFinite() || result.isNegative()) throw new Error("Суммы зарплаты не могут быть отрицательными");
  return result;
}

function fixed(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculation {
  const fixedAmount = nonNegative(input.fixedAmount);
  const revenueBase = nonNegative(input.revenueBase);
  const revenuePercent = nonNegative(input.revenuePercent);
  const bonusAmount = nonNegative(input.bonusAmount);
  const deductionAmount = nonNegative(input.deductionAmount);
  const advanceAmount = nonNegative(input.advanceAmount);
  const manualAdjustmentAmount = nonNegative(input.manualAdjustmentAmount);

  if (revenuePercent.gt(100)) throw new Error("Процент зарплаты должен быть от 0 до 100");

  const revenueAmount = revenueBase.mul(revenuePercent).div(100);
  const totalAmount = fixedAmount
    .plus(revenueAmount)
    .plus(bonusAmount)
    .plus(manualAdjustmentAmount)
    .minus(deductionAmount)
    .minus(advanceAmount);

  return {
    fixedAmount: fixed(fixedAmount),
    revenueBase: fixed(revenueBase),
    revenueAmount: fixed(revenueAmount),
    bonusAmount: fixed(bonusAmount),
    deductionAmount: fixed(deductionAmount),
    advanceAmount: fixed(advanceAmount),
    manualAdjustmentAmount: fixed(manualAdjustmentAmount),
    totalAmount: fixed(totalAmount),
  };
}

export function calculateOccupancy(occupiedMinutes: number, availableWorkingMinutes: number): number {
  if (!Number.isFinite(occupiedMinutes) || !Number.isFinite(availableWorkingMinutes) || availableWorkingMinutes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((occupiedMinutes / availableWorkingMinutes) * 1000) / 10));
}
