// Browser smoke check for the static export: desktop + mobile, mocked API, no runtime errors, no horizontal overflow.
// Usage: node scripts/serve-export.mjs, then CRM_PREVIEW_ORIGIN=http://127.0.0.1:8788 npm run qa:ui.
// Optional: PLAYWRIGHT_CHANNEL=chrome to use an installed Chrome, PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome for a custom binary.
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { URL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = (process.env.CRM_PREVIEW_ORIGIN || (process.env.CRM_PREVIEW_URL ? new URL(process.env.CRM_PREVIEW_URL).origin : "http://localhost:8788")).replace(/\/$/, "");
const launch = { headless: true };
if (process.env.PLAYWRIGHT_CHANNEL) launch.channel = process.env.PLAYWRIGHT_CHANNEL;
if (process.env.PLAYWRIGHT_CHROMIUM_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const shots = ".wrangler/qa";
await mkdir(shots, { recursive: true });
const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
const user = { id: "owner", telegramId: "100", name: "Владелец центра", role: "OWNER", clientId: null, notificationsAllowed: 1 };
const items = ["SCHEDULED", "IN_PROGRESS", "COMPLETED"].map((status, index) => ({
  id: "visit-" + index, revision: 0, clientId: "client-" + index, employeeId: "employee", branchId: "branch", clientName: ["Айгерим Садыкова", "Анна Иванова", "Мария Петрова"][index],
  clientPhone: "77001234567", startsAt: "2030-01-07T0" + (4 + index) + ":00:00Z", endsAt: "2030-01-07T0" + (5 + index) + ":00:00Z",
  status, amount: 18000, paidAmount: status === "COMPLETED" ? 18000 : 0, balance: status === "COMPLETED" ? 0 : 18000, serviceName: "Подологическая обработка", employeeName: "Диана", branchName: "Центр", notes: null, cancelReason: null, source: "ADMIN",
}));
const branch = { id: "branch", name: "Центр", address: "Улица, 1", phone: "+7 700 111 22 33", isActive: 1 };
const service = { id: "service", name: "Подологическая обработка", category: "Подология", price: 18000, cost: 2500, durationMinutes: 60, isActive: 1 };
const employee = { id: "employee", fullName: "Диана Ахметова", position: "Подолог", phone: "77001234567", email: null, branchId: "branch", branchName: "Центр", fixedSalary: 150000, revenuePercent: 30, isActive: 1, appointments: 12, revenue: 420000, serviceIds: ["service"] };
const client = { id: "client-0", fullName: "Айгерим Садыкова", phone: "+7 700 123 45 67", email: "client@example.test", notes: "Предпочитает утренние часы", createdAt: "2029-01-01T05:00:00.000Z", updatedAt: "2029-01-01T05:00:00.000Z", isActive: 1, visits: 4, lastVisit: "2029-12-20T05:00:00.000Z", nextVisit: "2030-01-07T04:00:00.000Z", total: 72000, status: "ACTIVE" };
const metrics = { clients: 128, todayAppointments: 3, monthAppointments: 54, revenue: 980000, expenses: 240000, payroll: 310000, activeEmployees: 4, grossRevenue: 1000000, refunds: 20000, newClients: 9, noShows: 2, averageCheck: 18148, occupiedMinutes: 3240, availableWorkingMinutes: 9600, occupancy: 33.8 };
function staffMock(path, request) {
  if (path === "/api/auth/me") return { ok: true, user };
  if (path === "/api/health") return { ok: true, version: "0.7.1", database: "ok", latencyMs: 12, timestamp: "2030-01-07T04:00:00.000Z" };
  if (path === "/api/settings") return { ok: true, settings: { brandName: "podologymk", currency: "KZT", timezone: "Asia/Almaty", bookingStartTime: "09:00", bookingEndTime: "18:00", bookingSlotInterval: 30, workingDays: "1,2,3,4,5,6", cancellationWindowHours: 2, loyaltyPointsPer1000: 1 }, branches: [branch] };
  if (path === "/api/notifications") return { ok: true, unreadCount: 1, items: [{ id: "n1", kind: "UPCOMING_APPOINTMENT", title: "Ближайшая запись", description: "Айгерим Садыкова", occurredAt: "2030-01-07T04:00:00.000Z", read: false, href: "/appointments" }] };
  if (path === "/api/operations") return { ok: true, date: "2030-01-07", timezone: "Asia/Almaty", items, queue: [{ status: "PENDING", count: 2 }], failures: [], waitlist: [{ id: "waiting-client", clientName: "Айдана Жумабаева", phone: "77001234567", serviceName: "Подология", branchName: "Центр", preferredDate: "2030-01-07" }], worker: { status: "OK", completedAt: "2030-01-07" }, workerStale: false, overdueBalances: { count: 1 } };
  if (path === "/api/dashboard") return { ok: true, metrics, upcoming: items, revenueByDay: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day: "2030-01-0" + day, amount: day * 12000 })), period: { from: "2029-12-31T19:00:00.000Z", to: "2030-01-31T19:00:00.000Z", timezone: "Asia/Almaty" } };
  if (path === "/api/appointments") return request.method() === "POST" ? { ok: true, id: "new" } : { ok: true, items, total: 3, page: 1, pageSize: 50, pages: 1 };
  if (path === "/api/appointment-catalog") return { ok: true, branches: [branch], employees: [employee], clients: [client, { ...client, id: "client-1", fullName: "Анна Иванова", phone: "+7 701 000 00 00" }], services: [service], truncated: false };
  if (path === "/api/clients") return { ok: true, items: [client, { ...client, id: "client-1", fullName: "Анна Иванова" }], total: 2, page: 1, pageSize: 25, pages: 1 };
  if (path.startsWith("/api/clients/")) return { ok: true, client, appointments: items.map((item) => ({ ...item, paidAmount: item.paidAmount })), payments: [{ id: "p1", amount: 18000, method: "CASH", status: "POSTED", paidAt: "2029-12-20T06:00:00.000Z", serviceName: service.name }], timeline: [{ type: "appointment", entityId: "visit-2", occurredAt: "2029-12-20T05:00:00.000Z", action: "COMPLETED", title: "Приём", details: null }] };
  if (path === "/api/employees") return { ok: true, payrollVisible: true, items: [employee, { ...employee, id: "e2", fullName: "Мадина Сейткали", isActive: 0 }] };
  if (path === "/api/branches") return { ok: true, items: [branch] };
  if (path === "/api/services") return { ok: true, costVisible: true, items: [service, { ...service, id: "s2", name: "Коррекция ногтя", isActive: 0 }] };
  if (path === "/api/finance") return { ok: true, items: [{ id: "x1", title: "Аренда кабинета", category: "RENT", branchId: "branch", branchName: "Центр", amount: 250000, occurredAt: "2030-01-05T05:00:00.000Z", status: "PAID", description: null, direction: "EXPENSE", expenseId: "exp-1" }, { id: "x2", title: "Оплата", category: "SERVICE", branchId: "branch", branchName: "Центр", amount: 18000, occurredAt: "2030-01-06T05:00:00.000Z", status: "PAID", description: null, direction: "INCOME" }] };
  if (path === "/api/rent") return { ok: true, items: [{ id: "r1", branchId: "branch", branchName: "Центр", periodStart: "2029-12-31T19:00:00.000Z", amount: 250000, dueDate: "2030-01-09T19:00:00.000Z", status: "DUE", paidAt: null, note: null }] };
  if (path === "/api/utilities") return { ok: true, items: [{ id: "u1", branchId: "branch", branchName: "Центр", kind: "ELECTRICITY", periodStart: "2029-12-31T19:00:00.000Z", previousMeterValue: 100, currentMeterValue: 160, consumption: 60, tariff: 25, fixedFee: 500, amount: 2000, dueDate: "2030-01-24T19:00:00.000Z", status: "PLANNED", paidAt: null, note: null }] };
  if (path === "/api/reconciliation") return { ok: true, healthy: true, checkedAt: "2030-01-07T04:00:00.000Z", checks: [{ key: "payments", label: "Оплаты и журнал", sourceAmount: 1, ledgerAmount: 1, difference: 0, sourceCount: 12, ledgerCount: 12, ok: true }] };
  if (path === "/api/payroll") return { ok: true, periods: [{ id: "pp1", periodStart: "2029-11-30T19:00:00.000Z", periodEnd: "2029-12-31T19:00:00.000Z", status: "CALCULATED", totalAmount: 310000, closedAt: null }], period: { id: "pp1", periodStart: "2029-11-30T19:00:00.000Z", periodEnd: "2029-12-31T19:00:00.000Z", status: "CALCULATED", totalAmount: 310000, closedAt: null }, lines: [{ id: "l1", employeeId: "employee", employeeName: employee.fullName, fixedAmount: 150000, revenueBase: 420000, revenuePercent: 30, revenueAmount: 126000, bonusAmount: 0, deductionAmount: 0, advanceAmount: 0, manualAdjustmentAmount: 0, totalAmount: 276000 }], adjustments: [] };
  if (path === "/api/inventory") return { ok: true, items: [{ id: "prod", name: "Бинт стерильный", sku: "SKU-1", unit: "шт", purchasePrice: 120, salePrice: 0, minStock: 10, optimalStock: 50, currentStock: 4, lowStock: 1, categoryName: "Расходники", supplierName: "МедТорг", branchId: "branch" }] };
  if (path.startsWith("/api/inventory/")) return { ok: true, items: [{ id: "sup", name: "МедТорг", contactName: null, phone: null, telegram: null, whatsapp: null, email: null, notes: null, isActive: 1 }] };
  if (path === "/api/reports") return { ok: true, period: { from: "2029-12-31T19:00:00.000Z", to: "2030-01-31T19:00:00.000Z" }, metrics: { revenue: 980000, grossRevenue: 1000000, refunds: 20000, expenses: 240000, payroll: 310000, profit: 430000, margin: 43.9, appointments: 60, completed: 54, cancelled: 4, noShow: 2, newClients: 9, uniqueClients: 48, returningClients: 30, repeatVisitRate: 62.5, averageCheck: 18148, occupiedMinutes: 3240, availableWorkingMinutes: 9600, occupancy: 33.8, revenuePerHour: 18148 }, employeeRevenue: [{ employeeId: "employee", employeeName: employee.fullName, appointments: 54, revenue: 980000 }], serviceRevenue: [{ serviceId: "service", serviceName: service.name, category: "Подология", revenue: 980000, snapshotAmount: 972000, appointments: 54 }] };
  if (path === "/api/schedules") return { ok: true, employees: [{ id: "employee", fullName: employee.fullName, position: "Подолог" }], schedules: [1, 2, 3, 4, 5].map((day) => ({ id: "sch" + day, employeeId: "employee", dayOfWeek: day, startsTime: "09:00", endsTime: "18:00", breakStartTime: "13:00", breakEndTime: "14:00", isActive: 1 })), timeOff: [{ id: "to1", employeeId: "employee", employeeName: employee.fullName, startsAt: "2030-02-01T04:00:00.000Z", endsAt: "2030-02-05T13:00:00.000Z", reason: "Отпуск" }] };
  if (path === "/api/users") return { ok: true, items: [{ id: "owner", telegramId: "100", username: "owner", name: "Владелец центра", role: "OWNER", active: 1, clientId: null, lastLoginAt: "2030-01-07T03:00:00.000Z", createdAt: "2029-01-01" }, { id: "admin", telegramId: "500", username: null, name: "Администратор", role: "ADMINISTRATOR", active: 1, clientId: null, lastLoginAt: null, createdAt: "2029-01-01" }] };
  if (path === "/api/pnl") return { ok: true, current: { metrics: { grossRevenue: 1000000, refunds: 20000, netRevenue: 980000, consumables: 60000, grossProfit: 920000, payroll: 310000, rent: 250000, utilities: 2000, otherExpenses: 0, operatingProfit: 358000, margin: 36.5 }, serviceRevenue: [{ serviceId: "service", serviceName: service.name, appointments: 54, revenue: 980000, contributionMargin: 920000 }], employeeRevenue: [{ employeeId: "employee", employeeName: employee.fullName, appointments: 54, revenue: 980000, contributionMargin: 920000 }], revenueByDay: [1, 2, 3].map((day) => ({ day: "2030-01-0" + day, amount: day * 50000 })), expenseBreakdown: [{ category: "RENT", amount: 250000 }, { category: "SALARY", amount: 310000 }] }, comparison: { netRevenue: { value: 980000, previous: 900000, change: 80000, changePercent: 8.9 }, grossProfit: { value: 920000, previous: 850000, change: 70000, changePercent: 8.2 }, operatingProfit: { value: 358000, previous: 400000, change: -42000, changePercent: -10.5 } } };
  if (path === "/api/kpi") return { ok: true, items: [{ employeeId: "employee", employeeName: employee.fullName, completedAppointments: 54, revenue: 980000, averageCheck: 18148, availableMinutes: 9600, occupiedMinutes: 3240, freeMinutes: 6360, occupancy: 33.8, noShows: 2, cancellations: 4, refunds: 20000, newClients: 9, returningClients: 30, repeatBookingRate: 62.5, consumablesCost: 60000, contributionMargin: 920000, payroll: 310000 }] };
  if (path === "/api/goals") return { ok: true, items: [{ id: "g1", metric: "REVENUE", targetValue: 1200000, fact: 980000, completionPercent: 82, forecast: 1150000, periodStart: "2029-12-31T19:00:00.000Z", periodEnd: "2030-01-31T19:00:00.000Z" }] };
  if (path === "/api/retention") return { ok: true, segments: [{ id: "vip", name: "Постоянные", description: "3+ визита", count: 12, system: true }, { id: "lost", name: "Давно не были", description: "90+ дней", count: 7, system: true }], clients: [{ id: "client-0", fullName: client.fullName, phone: client.phone, visits: 4, revenue: 72000, averageCheck: 18000, lastVisit: "2029-12-20T05:00:00.000Z", cancellations: 0, noShows: 0 }] };
  if (path === "/api/follow-ups") return { ok: true, items: [{ id: "f1", clientName: client.fullName, recommendedDate: "2030-01-20T05:00:00.000Z", status: "OPEN" }] };
  if (path === "/api/tasks") return { ok: true, items: [{ id: "t1", title: "Позвонить клиенту", description: null, dueDate: "2030-01-08T05:00:00.000Z", priority: "HIGH", status: "OPEN", clientName: client.fullName, assigneeName: "Администратор" }] };
  if (path === "/api/campaigns") return { ok: true, items: [{ id: "c1", name: "Весенняя акция", message: "Скидка 10% на обработку", status: "DRAFT", recipientCount: 0, sentCount: 0, errorCount: 0, scheduledAt: null }] };
  if (path === "/api/purchases") return { ok: true, items: [{ id: "pu1", supplierName: "МедТорг", branchName: "Центр", orderDate: "2030-01-03T05:00:00.000Z", status: "ORDERED", totalAmount: 12000, paidAmount: 0, itemCount: 1 }] };
  if (path === "/api/reviews") return { ok: true, items: [{ id: "rv1", appointmentId: "visit-2", rating: 5, reviewText: "Спасибо!", status: "PENDING", createdAt: "2029-12-21T05:00:00.000Z", clientName: client.fullName, serviceName: service.name }] };
  return { ok: true, items: [] };
}
const staffPages = ["/", "/today", "/appointments", "/clients", "/clients/client-0", "/employees", "/services", "/schedules", "/reviews", "/finance", "/payroll", "/reports", "/pnl", "/kpi", "/goals", "/inventory", "/purchases", "/suppliers", "/retention", "/tasks", "/campaigns", "/settings"];
async function noOverflow(page, label) {
  // eslint-disable-next-line no-undef
  const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflowing, false, "Layout overflows: " + label);
}
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" && !/favicon|net::ERR/.test(message.text())) errors.push(message.text()); });
    await page.route("https://telegram.org/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(staffMock(path, route.request())) });
    });
    for (const path of staffPages) {
      await page.goto(base + path);
      await page.locator("main h1").first().waitFor();
      await page.waitForTimeout(150);
      await noOverflow(page, path + " @ " + viewport.width);
      await page.screenshot({ path: `${shots}/${path === "/" ? "home" : path.slice(1).replace(/\//g, "-")}-${viewport.width}.png`, fullPage: true });
    }
    // Today: payment and waitlist flows.
    await page.goto(base + "/today");
    await page.getByText("Айгерим Садыкова", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Принять оплату", exact: true }).first().click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("spinbutton").fill("9000");
    await page.getByRole("button", { name: "Провести оплату", exact: true }).click();
    await page.getByText("Оплата проведена", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Закрыть заявку", exact: true }).click();
    await page.getByText("Заявка закрыта", { exact: true }).waitFor();
    // Appointments: the create dialog opens, shows the client picker, and Escape closes it.
    await page.goto(base + "/appointments");
    await page.getByRole("button", { name: "Новая запись", exact: true }).first().click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Новый клиент", exact: true }).click();
    await page.locator('input[type="tel"]').waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    // Clients: the create dialog and the services archive confirmation render in-app (no window.confirm).
    await page.goto(base + "/services");
    await page.getByRole("button", { name: /Архивировать/ }).first().click();
    await page.getByRole("dialog").getByText("Убрать услугу в архив?").waitFor();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    // An ambiguous network failure must reuse the same financial operation key.
    const expenseWrites = [];
    await page.route("**/api/finance", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      expenseWrites.push(route.request().postDataJSON());
      if (expenseWrites.length === 1) return route.abort("failed");
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, id: "expense", replayed: true }) });
    });
    await page.goto(base + "/finance");
    await page.getByRole("button", { name: "Добавить расход", exact: true }).click();
    await page.locator('#expense-form input[name="title"]').fill("Тест восстановления");
    await page.locator('#expense-form input[name="amount"]').fill("1000");
    await page.getByRole("button", { name: "Сохранить операцию", exact: true }).click();
    await page.getByText("Не удалось подключиться. Проверьте интернет и попробуйте ещё раз.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Сохранить операцию", exact: true }).click();
    await page.getByText("Операция добавлена в журнал", { exact: true }).waitFor();
    assert.equal(expenseWrites.length, 2);
    assert.ok(expenseWrites[0].idempotencyKey);
    assert.equal(expenseWrites[0].idempotencyKey, expenseWrites[1].idempotencyKey);
    await noOverflow(page, "expense network retry @ " + viewport.width);
    assert.deepEqual(errors, []);
    await context.close();
    console.log("Staff UI verified: " + viewport.width + "px; " + staffPages.length + " pages, payment, booking and archive dialogs; no runtime errors or overflow");
  }
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = []; const writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const clientUser = { ...user, id: "client-user", role: "CLIENT", clientId: "client", name: "Айгерим Садыкова", phone: "77001234567" };
    const profile = { id: "client", fullName: clientUser.name, phone: clientUser.phone, email: "client@example.test" };
    const slot = { startsAt: "2030-01-07T04:00:00Z", endsAt: "2030-01-07T05:00:00Z", employeeId: "employee", employeeName: "Диана", branchId: "branch", branchName: "Центр", serviceId: "service", price: 18000 };
    await page.route("https://telegram.org/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    await page.route("**/api/**", async (route) => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      if (request.method() === "POST") writes.push({ path, body: request.postDataJSON() });
      const body = path === "/api/auth/me" ? { ok: true, user: clientUser } :
        path === "/api/client/profile" ? { ok: true, user: clientUser, profile, archived: false, consents: [{ kind: "REMINDERS", version: "2026-08-10" }] } :
        path === "/api/client/catalog" ? { ok: true, user: clientUser, profile, archived: false, branches: [branch], services: [service] } :
        path === "/api/client/availability" ? { ok: true, items: [slot], next: null } :
        path === "/api/client/appointments" ? request.method() === "POST" ? { ok: true, id: "visit", changed: false } : { ok: true, items: [{ id: "visit", ...slot, amount: 18000, status: "SCHEDULED", serviceName: service.name, canCancel: true, checkInToken: "CODE", reviewId: null }] } :
        path === "/api/client/loyalty" ? { ok: true, account: { pointsBalance: 10, lifetimePoints: 10 }, transactions: [] } : { ok: true, items: [] };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    for (const path of ["/", "/client/appointments", "/client/loyalty", "/client/reviews"]) {
      await page.goto(base + path);
      await page.locator("h1").first().waitFor();
      await noOverflow(page, path + " @ " + viewport.width);
    }
    await page.goto(base + "/client/profile");
    await page.getByRole("button", { name: "Изменить", exact: true }).first().click();
    await page.locator('input[type="tel"]').fill("87007654321");
    await page.getByLabel("Получать акции и новости центра").check();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByText("Профиль сохранён", { exact: true }).waitFor();
    const saved = writes.find((item) => item.path === "/api/client/profile").body;
    assert.equal(saved.phone.replace(/\D/g, ""), "77007654321");
    assert.equal(saved.allowMarketing, true);
    await page.getByRole("button", { name: "Связаться с центром" }).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.getByRole("link", { name: "+7 700 111 22 33", exact: true }).getAttribute("href"), "tel:+77001112233");
    await page.keyboard.press("Escape");
    await page.goto(base + "/client/book");
    await page.getByRole("button", { name: /Подологическая обработка/ }).click();
    await page.getByRole("button", { name: /Центр/ }).click();
    await page.locator(".slot-button").first().click();
    await page.locator(".slot-button-selected").waitFor();
    await page.locator(".slot-button-selected").hover();
    // eslint-disable-next-line no-undef
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".slot-button-selected")).color === "rgb(255, 255, 255)");
    const selectedColors = await page.locator(".slot-button-selected").evaluate((element) => {
      // eslint-disable-next-line no-undef
      const styles = getComputedStyle(element);
      return { color: styles.color, background: styles.backgroundColor };
    });
    assert.equal(selectedColors.color, "rgb(255, 255, 255)");
    assert.notEqual(selectedColors.background, "rgb(240, 237, 255)");
    // eslint-disable-next-line no-undef
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${shots}/client-book-${viewport.width}.png`, fullPage: true });
    await noOverflow(page, "/client/book @ " + viewport.width);
    await page.getByRole("button", { name: "Подтвердить запись", exact: true }).click();
    await page.getByRole("heading", { name: "Запись подтверждена", exact: true }).waitFor();
    assert.ok(writes.find((item) => item.path === "/api/client/appointments").body.idempotencyKey);
    await page.goto(base + "/client/appointments");
    assert.equal(await page.getByRole("link", { name: "В календарь", exact: true }).getAttribute("href"), "/api/client/calendar?appointmentId=visit");
    assert.deepEqual(errors, []);
    await context.close();
    console.log("Client UI verified: " + viewport.width + "px; cabinet, profile with marketing consent, contacts, booking, calendar; no runtime errors or overflow");
  }
} finally { await browser.close(); }
