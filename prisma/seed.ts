import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for the dev seed");

const pool = new Pool({ connectionString, max: 2 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const owner = await prisma.user.upsert({
    where: { telegramId: process.env.SEED_OWNER_TELEGRAM_ID ?? "seed-owner-not-for-production" },
    update: { name: "Владелец podologymk", role: "OWNER", active: true },
    create: { telegramId: process.env.SEED_OWNER_TELEGRAM_ID ?? "seed-owner-not-for-production", name: "Владелец podologymk", role: "OWNER", active: true },
  });
  const branchNames = ["Сарыарка", "Центральный филиал"];
  const branches = [];
  for (const name of branchNames) {
    branches.push(await prisma.branch.upsert({ where: { id: `seed-${name}` }, update: { name, active: true }, create: { id: `seed-${name}`, name, active: true } }));
  }
  const employees = [];
  for (const [index, name] of ["Айгуль Садыкова", "Мария Ким", "Дана Омарова"].entries()) {
    const employee = await prisma.employee.upsert({ where: { id: `seed-employee-${index + 1}` }, update: { fullName: name, active: true }, create: { id: `seed-employee-${index + 1}`, fullName: name, position: "Подолог", fixedSalary: "0", revenuePercent: index === 0 ? "30" : "25", active: true } });
    const branch = branches[index % branches.length];
    await prisma.employeeBranch.upsert({ where: { employeeId_branchId: { employeeId: employee.id, branchId: branch.id } }, update: { isPrimary: true }, create: { employeeId: employee.id, branchId: branch.id, isPrimary: true } });
    employees.push(employee);
  }
  const service = await prisma.service.upsert({ where: { id: "seed-service-medical" }, update: { name: "Медицинский педикюр", price: "30000", durationMinutes: 90, active: true }, create: { id: "seed-service-medical", name: "Медицинский педикюр", category: "Подология", price: "30000", cost: "5000", durationMinutes: 90, active: true } });
  await prisma.service.upsert({ where: { id: "seed-service-consultation" }, update: { name: "Консультация подолога", price: "10000", durationMinutes: 30, active: true }, create: { id: "seed-service-consultation", name: "Консультация подолога", category: "Консультация", price: "10000", durationMinutes: 30, active: true } });
  const client = await prisma.client.upsert({ where: { id: "seed-client-1" }, update: { fullName: "Анна Иванова", phone: "+7 700 000 00 01", phoneNormalized: "77000000001", active: true }, create: { id: "seed-client-1", fullName: "Анна Иванова", phone: "+7 700 000 00 01", phoneNormalized: "77000000001", active: true } });
  const startsAt = new Date(Date.now() - 7 * 86_400_000);
  const endsAt = new Date(startsAt.getTime() + 90 * 60_000);
  const appointment = await prisma.appointment.upsert({ where: { id: "seed-appointment-1" }, update: { status: "COMPLETED", totalAmount: "30000", endsAt }, create: { id: "seed-appointment-1", clientId: client.id, employeeId: employees[0].id, branchId: branches[0].id, startsAt, endsAt, status: "COMPLETED", source: "ADMIN", totalAmount: "30000", createdById: owner.id, changedById: owner.id } });
  await prisma.appointmentService.upsert({ where: { appointmentId_serviceId: { appointmentId: appointment.id, serviceId: service.id } }, update: { price: "30000", durationMinutes: 90, quantity: 1 }, create: { appointmentId: appointment.id, serviceId: service.id, price: "30000", durationMinutes: 90, quantity: 1 } });
  const payment = await prisma.payment.upsert({ where: { id: "seed-payment-1" }, update: { amount: "30000", status: "POSTED" }, create: { id: "seed-payment-1", appointmentId: appointment.id, amount: "30000", method: "CARD", status: "POSTED", createdById: owner.id } });
  await prisma.financialTransaction.upsert({ where: { id: "seed-ledger-payment-1" }, update: { amount: "30000", status: "POSTED" }, create: { id: "seed-ledger-payment-1", direction: "INCOME", kind: "PAYMENT", category: "SERVICE", amount: "30000", status: "POSTED", occurredAt: payment.paidAt, appointmentId: appointment.id, paymentId: payment.id, branchId: branches[0].id, createdById: owner.id, description: "Seed payment" } });
  await prisma.expense.upsert({ where: { id: "seed-expense-1" }, update: { amount: "15000", status: "POSTED" }, create: { id: "seed-expense-1", title: "Расходные материалы", category: "SUPPLIES", amount: "15000", occurredAt: new Date(), status: "POSTED", branchId: branches[0].id, createdById: owner.id } });
}

main().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
