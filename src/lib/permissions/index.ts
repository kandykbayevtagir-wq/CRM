export type CrmRole = "OWNER" | "ADMINISTRATOR" | "SPECIALIST" | "ACCOUNTANT" | "CLIENT";

export type Permission =
  | "dashboard.read"
  | "reports.read"
  | "appointments.read"
  | "appointments.write"
  | "appointments.manage_all"
  | "clients.read"
  | "clients.write"
  | "clients.archive"
  | "services.read"
  | "services.write"
  | "employees.read"
  | "employees.write"
  | "schedules.read"
  | "schedules.write"
  | "payments.read"
  | "payments.write"
  | "finance.read"
  | "finance.write"
  | "payroll.read"
  | "payroll.write"
  | "settings.read"
  | "settings.write"
  | "audit.read"
  | "exports.read"
  | "reviews.read"
  | "reviews.write"
  | "users.read"
  | "users.write"
  | "notifications.read"
  | "notifications.write"
  | "inventory.read"
  | "inventory.write"
  | "purchases.read"
  | "purchases.write"
  | "goals.read"
  | "goals.write"
  | "retention.read"
  | "retention.write"
  | "campaigns.read"
  | "campaigns.write"
  | "tasks.read"
  | "tasks.write"
  | "kpi.read"
  | "pnl.read"
  | "search.read";

const ownerPermissions: readonly Permission[] = [
  "dashboard.read", "reports.read", "appointments.read", "appointments.write", "appointments.manage_all",
  "clients.read", "clients.write", "clients.archive", "services.read", "services.write", "employees.read",
  "employees.write", "schedules.read", "schedules.write", "payments.read", "payments.write", "finance.read",
  "finance.write", "payroll.read", "payroll.write", "settings.read", "settings.write", "audit.read", "exports.read",
  "reviews.read", "reviews.write", "users.read", "users.write", "notifications.read", "notifications.write",
  "inventory.read", "inventory.write", "purchases.read", "purchases.write", "goals.read", "goals.write",
  "retention.read", "retention.write", "campaigns.read", "campaigns.write", "tasks.read", "tasks.write",
  "kpi.read", "pnl.read", "search.read",
];

const rolePermissions: Record<CrmRole, readonly Permission[]> = {
  OWNER: ownerPermissions,
  ADMINISTRATOR: [
    "dashboard.read", "appointments.read", "appointments.write", "appointments.manage_all", "clients.read", "clients.write",
    "clients.archive", "services.read", "employees.read", "schedules.read", "payments.read", "payments.write", "reviews.read",
    "reviews.write", "exports.read", "settings.read", "notifications.read", "notifications.write",
    "inventory.read", "inventory.write", "purchases.read", "purchases.write", "goals.read", "goals.write",
    "retention.read", "retention.write", "campaigns.read", "campaigns.write", "tasks.read", "tasks.write", "search.read",
  ],
  SPECIALIST: [
    "appointments.read", "appointments.write", "clients.read", "services.read", "schedules.read", "reviews.read", "notifications.read",
    "tasks.read", "tasks.write", "retention.read", "retention.write", "search.read",
  ],
  ACCOUNTANT: [
    "dashboard.read", "reports.read", "payments.read", "finance.read", "finance.write", "payroll.read", "payroll.write", "exports.read", "audit.read", "notifications.read",
    "inventory.read", "inventory.write", "purchases.read", "purchases.write", "pnl.read", "kpi.read", "goals.read", "goals.write", "search.read",
  ],
  CLIENT: [],
};

export function hasPermission(role: string, permission: Permission): boolean {
  const permissions = rolePermissions[role as CrmRole];
  return Boolean(permissions?.includes(permission));
}

export function permissionsForRole(role: string): readonly Permission[] {
  return rolePermissions[role as CrmRole] ?? [];
}

export function canManageAppointment(role: string, employeeId: string | null, ownEmployeeId: string | null): boolean {
  return hasPermission(role, "appointments.manage_all") || (hasPermission(role, "appointments.write") && employeeId !== null && employeeId === ownEmployeeId);
}
