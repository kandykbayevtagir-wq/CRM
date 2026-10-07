import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createSession } from "../functions/_lib/auth";
import type { CrmEnv } from "../functions/_lib/env";

export function testDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of readdirSync(resolve("migrations")).filter((file) => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync(resolve("migrations", migration), "utf8"));
  class Statement {
    constructor(public query: string, public values: SQLInputValue[] = []) {}
    bind(...values: SQLInputValue[]) { return new Statement(this.query, values); }
    async first<T>() { return (sqlite.prepare(this.query).get(...this.values) ?? null) as T | null; }
    async all<T>() { return { success: true, results: sqlite.prepare(this.query).all(...this.values) as T[], meta: { changes: 0 } }; }
    async run() { const result = sqlite.prepare(this.query).run(...this.values); return { success: true, meta: { changes: Number(result.changes) }, results: [] }; }
  }
  const db = {
    prepare(query: string) { return new Statement(query); },
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return { sqlite, db };
}

export function seed(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO branches(id,name,address,is_active) VALUES('branch','Центр','Улица, 1',1);
    INSERT INTO clients(id,full_name,phone,phone_normalized,notes,profile_notes,is_active) VALUES('client','Клиент','77001234567','77001234567','Внутренняя заметка','Личное предпочтение',1);
    INSERT INTO clients(id,full_name,phone,phone_normalized,is_active) VALUES('other-client','Другой клиент','77009876543','77009876543',1);
    INSERT INTO users(id,telegram_id,name,role,active,client_id,notifications_allowed) VALUES('owner','100','Владелец','OWNER',1,NULL,1),('user','200','Клиент','CLIENT',1,'client',1),('other-user','300','Другой','CLIENT',1,'other-client',1),('specialist','400','Специалист','SPECIALIST',1,NULL,1);
    INSERT INTO employees(id,full_name,position,is_active,user_id) VALUES('employee','Специалист','Подолог',1,'specialist'),('other-employee','Другой специалист','Подолог',1,NULL);
    INSERT INTO employee_branches(employee_id,branch_id) VALUES('employee','branch'),('other-employee','branch');
    INSERT INTO services(id,name,price,duration_minutes,is_active) VALUES('service','Услуга',10000,60,1);
    INSERT INTO employee_services(id,employee_id,service_id) VALUES('assignment','employee','service'),('assignment-other','other-employee','service');
  `);
  for (let day = 1; day <= 7; day++) sqlite.prepare("INSERT INTO employee_schedules(id,employee_id,day_of_week,starts_time,ends_time,is_active) VALUES(?, 'employee', ?, '09:00','18:00',1)").run("shift-" + day, day);
  sqlite.exec("UPDATE organization_settings SET working_days = '1,2,3,4,5,6,7'");
}

export function seedVisit(sqlite: DatabaseSync, id = "visit", status = "SCHEDULED", starts = "2030-01-07T04:00:00.000Z", employee = "employee", client = "client") {
  const canonical = starts.includes("T") ? starts : starts.replace(" ", "T") + "Z";
  const ends = new Date(Date.parse(canonical) + 3600000).toISOString();
  sqlite.prepare("INSERT INTO appointments(id,client_id,employee_id,branch_id,starts_at,ends_at,status,total_amount,check_in_token,notes) VALUES(?,?,?,'branch',?,?,?,10000,?,'Внутренняя заметка визита')").run(id,client,employee,starts,ends,status,"TOKEN" + id.toUpperCase().replace(/[^A-Z0-9]/g,""));
  sqlite.prepare("INSERT INTO appointment_services(appointment_id,service_id,price,duration_minutes,quantity) VALUES(?,'service',10000,60,1)").run(id);
}

export async function requestContext(db: D1Database, path: string, method = "GET", body?: Record<string, unknown>, userId = "owner", params: Record<string,string> = {}) {
  const token = await createSession(db,userId);
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_WEBHOOK_SECRET: "test-secret", MINI_APP_URL: "https://crm.test", CRM_OWNER_TELEGRAM_ID: "100", CRM_ALLOWED_TELEGRAM_IDS: "100,400" } as unknown as CrmEnv;
  const request = new Request("https://crm.test" + path, { method, headers: { "content-type": "application/json", cookie: "pmk_session=" + token }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const background: Promise<unknown>[] = [];
  const context = { env, request, params, waitUntil(promise: Promise<unknown>) { background.push(promise); }, data: {}, next: async () => new Response("ok"), functionPath: path, passThroughOnException() {} };
  return { context: context as unknown as EventContext<CrmEnv,string,Record<string,unknown>>, background };
}
