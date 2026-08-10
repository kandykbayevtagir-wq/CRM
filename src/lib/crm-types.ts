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
  startsAt: string;
  endsAt?: string | null;
  status: string;
  amount: number;
  notes: string | null;
  clientName: string;
  clientPhone: string;
  serviceName: string | null;
  employeeName: string | null;
  branchName: string | null;
  paidAmount?: number;
  balance?: number;
  source?: string | null;
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
  userId?: string | null;
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
    expenses: number;
    payroll: number;
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
  };
  branches: Branch[];
};

export type ServiceRecord = {
  id: string;
  name: string;
  category: string;
  price: number;
  cost?: number;
  durationMinutes: number;
  isActive: number;
};

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

export type ClientAppointment = AppointmentRecord & {
  serviceId: string | null;
  reviewId: string | null;
  checkInToken: string | null;
  canCancel: boolean;
};

export type LoyaltyResponse = {
  ok: true;
  account: { pointsBalance: number; lifetimePoints: number };
  transactions: Array<{ id: string; points: number; kind: string; description: string; createdAt: string }>;
};
