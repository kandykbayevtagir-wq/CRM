export type AuthUser = {
  id: string;
  telegramId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  role: string;
};

export type AuthResponse = { ok: true; user: AuthUser };

export type Branch = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: number;
};

export type ClientRecord = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  visits: number;
  lastVisit: string | null;
  total: number;
  status: string;
};

export type AppointmentRecord = {
  id: string;
  startsAt: string;
  status: string;
  amount: number;
  notes: string | null;
  clientName: string;
  clientPhone: string;
  serviceName: string | null;
  employeeName: string | null;
  branchName: string | null;
};

export type EmployeeRecord = {
  id: string;
  fullName: string;
  position: string;
  phone: string | null;
  email: string | null;
  branchId: string | null;
  branchName: string | null;
  fixedSalary: number;
  revenuePercent: number;
  isActive: number;
  appointments: number;
  revenue: number;
};

export type ExpenseRecord = {
  id: string;
  title: string;
  category: string;
  branchId: string | null;
  branchName: string | null;
  amount: number;
  occurredAt: string;
  status: string;
  description: string | null;
};

export type DashboardResponse = {
  ok: true;
  metrics: {
    clients: number;
    todayAppointments: number;
    monthAppointments: number;
    revenue: number;
    expenses: number;
    payroll: number;
    activeEmployees: number;
  };
  upcoming: Array<AppointmentRecord>;
  revenueByDay: Array<{ day: string; amount: number }>;
};

export type SettingsResponse = {
  ok: true;
  settings: { brandName: string; currency: string; timezone: string };
  branches: Branch[];
};
