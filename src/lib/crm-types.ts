export type AuthUser = {
  id: string;
  telegramId: string;
  name: string;
  username: string | null;
  telegramUsername?: string | null;
  avatarUrl: string | null;
  role: string;
  active?: number;
  lastLoginAt?: string | null;
  clientId: string | null;
  phone: string | null;
  notificationsAllowed: number;
};

export type AuthResponse = { ok: true; user: AuthUser };

export type CrmNotification = {
  id: string;
  kind: string;
  title: string;
  description: string;
  occurredAt: string;
  read: boolean;
  href?: string | null;
};

export type NotificationsResponse = {
  ok: true;
  unreadCount: number;
  items: CrmNotification[];
};

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
  isActive?: number;
  visits: number;
  lastVisit: string | null;
  nextVisit?: string | null;
  total: number;
  status: string;
};

export type AppointmentRecord = {
  id: string;
  /** Optimistic-concurrency version; every PATCH sends it back. */
  revision?: number;
  startsAt: string;
  endsAt?: string | null;
  status: string;
  amount: number;
  notes: string | null;
  clientId?: string;
  employeeId?: string | null;
  branchId?: string | null;
  clientName: string;
  clientPhone: string;
  serviceName: string | null;
  employeeName: string | null;
  branchName: string | null;
  paidAmount?: number;
  balance?: number;
  source?: string | null;
  cancelReason?: string | null;
};

export type AppointmentsResponse = { ok: true; items: AppointmentRecord[]; total?: number; page?: number; pageSize?: number; pages?: number };
export type ClientsResponse = { ok: true; items: ClientRecord[]; total: number; page: number; pageSize: number; pages: number; restricted?: boolean };

export type EmployeeRecord = {
  id: string;
  fullName: string;
  position: string;
  phone: string | null;
  email: string | null;
  branchId: string | null;
  branchName: string | null;
  /** Present only for roles with payroll.read. */
  fixedSalary?: number;
  revenuePercent?: number;
  isActive: number;
  appointments: number;
  /** Present only for roles with payroll.read. */
  revenue?: number;
  userId?: string | null;
  serviceIds?: string[];
};

export type EmployeesResponse = { ok: true; items: EmployeeRecord[]; payrollVisible?: boolean };

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
  direction?: string;
  kind?: string;
  appointmentId?: string | null;
  expenseId?: string | null;
};

export type DashboardResponse = {
  ok: true;
  metrics: {
    clients: number;
    todayAppointments: number;
    monthAppointments: number;
    revenue: number;
    /** null when the role may not read finance. */
    expenses: number | null;
    /** null when the role may not read payroll. */
    payroll: number | null;
    activeEmployees: number;
    grossRevenue?: number;
    refunds?: number;
    newClients?: number;
    noShows?: number;
    averageCheck?: number;
    occupiedMinutes?: number;
    availableWorkingMinutes?: number;
    occupancy?: number;
  };
  upcoming: Array<AppointmentRecord>;
  revenueByDay: Array<{ day: string; amount: number }>;
  period?: { from: string; to: string; timezone: string };
};

export type SettingsResponse = {
  ok: true;
  settings: {
    brandName: string;
    currency: string;
    timezone: string;
    bookingStartTime: string;
    bookingEndTime: string;
    bookingSlotInterval: number;
    workingDays: string;
    cancellationWindowHours: number;
    loyaltyPointsPer1000: number;
    dailySummaryEnabled?:number;
    dailySummaryHour?:number;
  };
  branches: Branch[];
};

export type ServiceRecord = {
  id: string;
  name: string;
  category: string;
  price: number;
  /** null when the role may not see cost prices. */
  cost?: number | null;
  durationMinutes: number;
  isActive: number;
};

export type ServicesResponse = { ok: true; items: ServiceRecord[]; costVisible?: boolean };

export type RentRecord = { id: string; branchId: string; branchName: string | null; periodStart: string; amount: number; dueDate: string; status: string; paidAt: string | null; note: string | null };
export type UtilityRecord = { id: string; branchId: string; branchName: string | null; kind: string; periodStart: string; previousMeterValue: number; currentMeterValue: number; consumption: number; tariff: number; fixedFee: number; amount: number; dueDate: string; status: string; paidAt: string | null; note: string | null };
export type ReconciliationCheck = { key: string; label: string; sourceAmount: number; ledgerAmount: number; difference: number; sourceCount: number; ledgerCount: number; ok: boolean };

export type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  serviceId: string;
  price: number;
};

export type AvailabilityResponse = { ok: true; items: AvailabilitySlot[]; next?: AvailabilitySlot | null };

export type ClientAppointment = AppointmentRecord & {
  serviceId: string | null;
  branchId?: string | null;
  employeeId?: string | null;
  reviewId: string | null;
  checkInToken: string | null;
  canCancel: boolean;
};

export type LoyaltyResponse = {
  ok: true;
  account: { pointsBalance: number; lifetimePoints: number };
  transactions: Array<{ id: string; points: number; kind: string; description: string; createdAt: string }>;
};
