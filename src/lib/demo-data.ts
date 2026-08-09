import type { Appointment, Client, Employee, Expense } from "@/types";

export const dashboardMetrics = [
  { label: "Выручка за месяц", value: "4,2 млн ₸", change: "+12,8%", trend: "up", tone: "mint" },
  { label: "Операционная прибыль", value: "1,8 млн ₸", change: "+8,4%", trend: "up", tone: "lavender" },
  { label: "Начислено зарплат", value: "1,18 млн ₸", change: "+4,1%", trend: "up", tone: "peach" },
  { label: "Записей за месяц", value: "286", change: "+18,6%", trend: "up", tone: "sky" },
] as const;

export const appointments: Appointment[] = [
  { id: "a-01", time: "09:00", client: "Алия Нурланова", phone: "+7 701 234 56 78", specialist: "Айдана К.", service: "Медицинский педикюр", branch: "Астана · Сарыарка", status: "completed", amount: 18000 },
  { id: "a-02", time: "10:30", client: "Мария Соколова", phone: "+7 705 442 11 90", specialist: "Диана М.", service: "Обработка вросшего ногтя", branch: "Астана · Сарыарка", status: "in_progress", amount: 22000 },
  { id: "a-03", time: "12:00", client: "Ермек Тлеужанов", phone: "+7 747 010 38 29", specialist: "Айдана К.", service: "Консультация подолога", branch: "Астана · Есиль", status: "confirmed", amount: 12000 },
  { id: "a-04", time: "14:30", client: "Ольга Ким", phone: "+7 777 901 44 22", specialist: "Наталья С.", service: "Медицинский педикюр", branch: "Астана · Есиль", status: "scheduled", amount: 18000 },
  { id: "a-05", time: "16:00", client: "Сауле Ахметова", phone: "+7 702 881 12 03", specialist: "Диана М.", service: "Ортонексия", branch: "Астана · Сарыарка", status: "scheduled", amount: 25000 },
];

export const employees: Employee[] = [
  { id: "e-01", name: "Айдана Касымова", role: "Врач-подолог", branch: "Сарыарка", phone: "+7 701 223 41 55", revenue: 1480000, appointments: 92, payroll: 424000, percent: 30, initials: "АК", tone: "violet" },
  { id: "e-02", name: "Диана Мухаметова", role: "Подолог", branch: "Сарыарка", phone: "+7 705 624 10 17", revenue: 1160000, appointments: 78, payroll: 348000, percent: 30, initials: "ДМ", tone: "blue" },
  { id: "e-03", name: "Наталья Садыкова", role: "Подолог", branch: "Есиль", phone: "+7 747 789 32 10", revenue: 980000, appointments: 64, payroll: 294000, percent: 30, initials: "НС", tone: "peach" },
  { id: "e-04", name: "Алина Жаксылыкова", role: "Администратор", branch: "Есиль", phone: "+7 777 256 12 80", revenue: 0, appointments: 0, payroll: 114000, percent: 0, initials: "АЖ", tone: "mint" },
];

export const clients: Client[] = [
  { id: "c-01", name: "Алия Нурланова", phone: "+7 701 234 56 78", lastVisit: "Сегодня, 09:00", visits: 8, total: 142000, status: "active" },
  { id: "c-02", name: "Мария Соколова", phone: "+7 705 442 11 90", lastVisit: "Сегодня, 10:30", visits: 4, total: 78000, status: "active" },
  { id: "c-03", name: "Ермек Тлеужанов", phone: "+7 747 010 38 29", lastVisit: "Сегодня, 12:00", visits: 1, total: 12000, status: "new" },
  { id: "c-04", name: "Ольга Ким", phone: "+7 777 901 44 22", lastVisit: "12 июля 2026", visits: 12, total: 226000, status: "active" },
  { id: "c-05", name: "Сауле Ахметова", phone: "+7 702 881 12 03", lastVisit: "28 июня 2026", visits: 6, total: 115000, status: "active" },
  { id: "c-06", name: "Гульмира Есенова", phone: "+7 700 355 19 41", lastVisit: "02 апреля 2026", visits: 2, total: 34000, status: "inactive" },
];

export const expenses: Expense[] = [
  { id: "x-01", title: "Аренда · Сарыарка", category: "Аренда", branch: "Сарыарка", date: "01 августа 2026", amount: 310000, status: "paid" },
  { id: "x-02", title: "Электроэнергия · Есиль", category: "Коммунальные", branch: "Есиль", date: "05 августа 2026", amount: 42000, status: "paid" },
  { id: "x-03", title: "Материалы для кабинета", category: "Расходники", branch: "Сарыарка", date: "07 августа 2026", amount: 68500, status: "paid" },
  { id: "x-04", title: "Продвижение в Instagram", category: "Реклама", branch: "Все филиалы", date: "15 августа 2026", amount: 85000, status: "planned" },
  { id: "x-05", title: "Интернет · Есиль", category: "Коммунальные", branch: "Есиль", date: "20 августа 2026", amount: 12500, status: "planned" },
];

export const revenueBars = [
  { day: "Пн", value: 52 },
  { day: "Вт", value: 68 },
  { day: "Ср", value: 58 },
  { day: "Чт", value: 76 },
  { day: "Пт", value: 64 },
  { day: "Сб", value: 88 },
  { day: "Вс", value: 48 },
];
