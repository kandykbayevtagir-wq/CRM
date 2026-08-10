import { calculatePayroll } from "../../src/lib/finance/payroll";
import { auditStatement } from "./audit";
import type { AuthUser } from "./auth";
import { newId } from "./http";

type EmployeeRow = { id: string; fullName: string; fixedSalary: number; revenuePercent: number };
type AdjustmentRow = { employeeId: string; kind: string; amount: number; reason: string };

export async function calculatePayrollPeriod(db: D1Database, periodId: string, actor: AuthUser) {
  const period = await db.prepare("SELECT id, period_start AS periodStart, period_end AS periodEnd, status, closed_at AS closedAt FROM payroll_periods WHERE id = ?").bind(periodId).first<{ id: string; periodStart: string; periodEnd: string; status: string; closedAt: string | null }>();
  if (!period) throw new Error("Расчётный период не найден");
  if (period.status === "CLOSED") throw new Error("Закрытый период нельзя пересчитать");
  const [employees, adjustments] = await Promise.all([
    db.prepare("SELECT id, full_name AS fullName, fixed_salary AS fixedSalary, revenue_percent AS revenuePercent FROM employees WHERE is_active = 1 ORDER BY full_name").all<EmployeeRow>(),
    db.prepare("SELECT employee_id AS employeeId, kind, amount, reason FROM payroll_adjustments WHERE period_id = ? ORDER BY created_at").bind(periodId).all<AdjustmentRow>(),
  ]);
  const adjustmentRows = adjustments.results ?? [];
  const lines: Array<{ employee: EmployeeRow; calculation: ReturnType<typeof calculatePayroll>; details: Record<string, unknown> }> = [];
  for (const employee of employees.results ?? []) {
    const revenue = await db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) - COALESCE((
        SELECT SUM(pa.amount) FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id
        WHERE rp.appointment_id IN (SELECT id FROM appointments WHERE employee_id = ? AND status = 'COMPLETED')
          AND pa.occurred_at >= ? AND pa.occurred_at < ?
      ), 0) AS value
      FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id
      WHERE a.employee_id = ? AND a.status = 'COMPLETED' AND p.payment_status = 'POSTED'
        AND p.paid_at >= ? AND p.paid_at < ?
    `).bind(employee.id, period.periodStart, period.periodEnd, employee.id, period.periodStart, period.periodEnd).first<{ value: number }>();
    const employeeAdjustments = adjustmentRows.filter((row) => row.employeeId === employee.id);
    const bonusAmount = employeeAdjustments.filter((row) => row.kind === "BONUS").reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const deductionAmount = employeeAdjustments.filter((row) => row.kind === "DEDUCTION").reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const advanceAmount = employeeAdjustments.filter((row) => row.kind === "ADVANCE").reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const manualAdjustmentAmount = employeeAdjustments.filter((row) => row.kind === "MANUAL").reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const calculation = calculatePayroll({ fixedAmount: employee.fixedSalary, revenueBase: revenue?.value ?? 0, revenuePercent: employee.revenuePercent, bonusAmount, deductionAmount, advanceAmount, manualAdjustmentAmount });
    lines.push({ employee, calculation, details: { adjustments: employeeAdjustments, source: "POSTED_PAYMENTS_OF_COMPLETED_APPOINTMENTS", periodStart: period.periodStart, periodEnd: period.periodEnd } });
  }
  const total = lines.reduce((sum, line) => sum + Number(line.calculation.totalAmount), 0);
  const statements: D1PreparedStatement[] = [];
  for (const line of lines) {
    const c = line.calculation;
    statements.push(db.prepare(`
      INSERT INTO payroll_lines (id, period_id, employee_id, fixed_amount, revenue_base, revenue_percent, revenue_amount, bonus_amount, deduction_amount, advance_amount, manual_adjustment_amount, total_amount, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(period_id, employee_id) DO UPDATE SET fixed_amount = excluded.fixed_amount, revenue_base = excluded.revenue_base, revenue_percent = excluded.revenue_percent, revenue_amount = excluded.revenue_amount, bonus_amount = excluded.bonus_amount, deduction_amount = excluded.deduction_amount, advance_amount = excluded.advance_amount, manual_adjustment_amount = excluded.manual_adjustment_amount, total_amount = excluded.total_amount, details_json = excluded.details_json
    `).bind(newId(), periodId, line.employee.id, c.fixedAmount, c.revenueBase, line.employee.revenuePercent, c.revenueAmount, c.bonusAmount, c.deductionAmount, c.advanceAmount, c.manualAdjustmentAmount, c.totalAmount, JSON.stringify(line.details)));
  }
  statements.push(
    db.prepare("UPDATE payroll_periods SET status = 'CALCULATED', total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status <> 'CLOSED'").bind(total, periodId),
    auditStatement(db, actor, "payroll_period", periodId, "CALCULATE", null, { totalAmount: total, lineCount: lines.length }),
  );
  await db.batch(statements);
  return { periodId, status: "CALCULATED", totalAmount: total, lines: lines.map((line) => ({ employeeId: line.employee.id, employeeName: line.employee.fullName, ...line.calculation })) };
}

export async function closePayrollPeriod(db: D1Database, periodId: string, actor: AuthUser) {
  const period = await db.prepare("SELECT id, status, total_amount AS totalAmount, period_end AS periodEnd, ledger_transaction_id AS ledgerId FROM payroll_periods WHERE id = ?").bind(periodId).first<{ id: string; status: string; totalAmount: number; periodEnd: string; ledgerId: string | null }>();
  if (!period) throw new Error("Расчётный период не найден");
  if (period.status === "CLOSED") return { periodId, status: "CLOSED", totalAmount: Number(period.totalAmount ?? 0) };
  if (period.status !== "CALCULATED") throw new Error("Сначала рассчитайте период");
  const ledgerId = period.ledgerId ?? newId();
  await db.batch([
    db.prepare("UPDATE payroll_periods SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP, closed_by = ?, ledger_transaction_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'CALCULATED'").bind(actor.id, ledgerId, periodId),
    db.prepare("INSERT OR IGNORE INTO financial_transactions (id, direction, kind, category, amount, status, occurred_at, payroll_period_id, description, created_by) VALUES (?, 'EXPENSE', 'SALARY', 'SALARY', ?, 'POSTED', ?, ?, 'Закрытый расчёт зарплаты', ?)").bind(ledgerId, Number(period.totalAmount ?? 0), period.periodEnd, periodId, actor.id),
    auditStatement(db, actor, "payroll_period", periodId, "CLOSE", { status: "CALCULATED", totalAmount: period.totalAmount }, { status: "CLOSED", totalAmount: period.totalAmount }),
  ]);
  return { periodId, status: "CLOSED", totalAmount: Number(period.totalAmount ?? 0) };
}
