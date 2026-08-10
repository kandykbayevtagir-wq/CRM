export type LedgerDirection = "INCOME" | "EXPENSE";
export type LedgerKind = "PAYMENT" | "REFUND" | "EXPENSE" | "RENT" | "UTILITIES" | "SALARY" | "OTHER";

export type LedgerTotals = {
  grossIncome: number;
  refunds: number;
  expenses: number;
  netIncome: number;
  operatingProfit: number;
};

export function calculateLedgerTotals(rows: Array<{ direction: LedgerDirection; kind: LedgerKind; amount: number }>): LedgerTotals {
  let grossIncome = 0;
  let refunds = 0;
  let expenses = 0;
  for (const row of rows) {
    const amount = Number.isFinite(row.amount) && row.amount >= 0 ? row.amount : 0;
    if (row.kind === "PAYMENT" && row.direction === "INCOME") grossIncome += amount;
    else if (row.kind === "REFUND" && row.direction === "INCOME") refunds += amount;
    else if (row.direction === "EXPENSE") expenses += amount;
  }
  const netIncome = grossIncome - refunds;
  return { grossIncome, refunds, expenses, netIncome, operatingProfit: netIncome - expenses };
}
