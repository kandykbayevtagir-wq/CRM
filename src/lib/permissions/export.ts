import { hasPermission, type Permission } from "./index";

const exportPermissions: Record<string, Permission> = {
  clients: "clients.read", appointments: "appointments.read", payments: "payments.read",
  expenses: "finance.read", payroll: "payroll.read", inventory: "inventory.read",
  "stock-movements": "inventory.read", purchases: "purchases.read", kpi: "kpi.read", pnl: "pnl.read", tasks: "tasks.read",
};
export function canExport(role: string, type: string) {
  return hasPermission(role, "exports.read") && Boolean(exportPermissions[type] && hasPermission(role, exportPermissions[type]));
}
