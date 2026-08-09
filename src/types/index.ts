export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export type Appointment = {
  id: string;
  time: string;
  client: string;
  phone: string;
  specialist: string;
  service: string;
  branch: string;
  status: AppointmentStatus;
  amount: number;
};

export type Employee = {
  id: string;
  name: string;
  role: string;
  branch: string;
  phone: string;
  revenue: number;
  appointments: number;
  payroll: number;
  percent: number;
  initials: string;
  tone: string;
};

export type Client = {
  id: string;
  name: string;
  phone: string;
  lastVisit: string;
  visits: number;
  total: number;
  status: "active" | "new" | "inactive";
};

export type Expense = {
  id: string;
  title: string;
  category: string;
  branch: string;
  date: string;
  amount: number;
  status: "paid" | "planned";
};
