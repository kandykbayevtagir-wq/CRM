export function remainingPaymentBalance(totalAmount: number, payments: number[], refunds: number[] = []): number {
  const total = Number.isFinite(totalAmount) && totalAmount >= 0 ? totalAmount : 0;
  const paid = payments.reduce((sum, amount) => sum + (Number.isFinite(amount) && amount >= 0 ? amount : 0), 0);
  const returned = refunds.reduce((sum, amount) => sum + (Number.isFinite(amount) && amount >= 0 ? amount : 0), 0);
  return Math.max(0, total - paid + returned);
}
