import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function applyUpTo(sqlite: DatabaseSync, lastPrefix: string) {
  for (const file of readdirSync(resolve("migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    if (file.slice(0, 4) > lastPrefix) break;
    sqlite.exec(readFileSync(resolve("migrations", file), "utf8"));
  }
}
function applyOnly(sqlite: DatabaseSync, prefixes: string[]) {
  for (const file of readdirSync(resolve("migrations")).filter((name) => name.endsWith(".sql")).sort()) if (prefixes.includes(file.slice(0, 4))) sqlite.exec(readFileSync(resolve("migrations", file), "utf8"));
}
function seedLegacy(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO branches(id,name,is_active) VALUES('branch','Центр',1);
    INSERT INTO clients(id,full_name,phone,phone_normalized,is_active) VALUES('c1','Один','77001','77001',1),('c2','Два','77002','77002',1);
    INSERT INTO employees(id,full_name,position,is_active) VALUES('e1','Мастер','Подолог',1);
    INSERT INTO appointments(id,client_id,employee_id,branch_id,starts_at,ends_at,status,total_amount) VALUES
      ('a1','c1','e1','branch','2026-03-01 04:00:00','2026-03-01 05:00:00','SCHEDULED',1000),
      ('a2','c2','e1','branch','2026-03-01 04:30:00','2026-03-01 05:30:00','SCHEDULED',1000),
      ('a3','c2','e1','branch','2026-03-01 08:00:00','2026-03-01 09:00:00','CANCELLED',1000);
  `);
}

describe("migration 0012", () => {
  it("lets pre-existing overlapping appointments change status but still blocks new overlaps", () => {
    const sqlite = new DatabaseSync(":memory:");
    applyUpTo(sqlite, "0010");
    seedLegacy(sqlite);
    // With only 0011 the status change on a legacy overlap was impossible.
    const withEleven = new DatabaseSync(":memory:");
    applyUpTo(withEleven, "0010"); seedLegacy(withEleven); applyOnly(withEleven, ["0011"]);
    expect(() => withEleven.exec("UPDATE appointments SET status = 'CONFIRMED' WHERE id = 'a1'")).toThrow("CRM_SLOT_UNAVAILABLE");
    withEleven.close();
    applyOnly(sqlite, ["0011", "0012"]);
    sqlite.exec("UPDATE appointments SET status = 'CONFIRMED' WHERE id = 'a1'");
    sqlite.exec("UPDATE appointments SET status = 'ARRIVED' WHERE id = 'a1'");
    sqlite.exec("UPDATE appointments SET status = 'IN_PROGRESS', starts_at = starts_at, ends_at = ends_at WHERE id = 'a1'");
    expect(sqlite.prepare("SELECT status FROM appointments WHERE id = 'a1'").get()?.status).toBe("IN_PROGRESS");
    // Moving a2 onto a1 is still an overlap.
    expect(() => sqlite.exec("UPDATE appointments SET starts_at = '2026-03-01T04:00:00.000Z', ends_at = '2026-03-01T05:00:00.000Z' WHERE id = 'a2'")).toThrow("CRM_SLOT_UNAVAILABLE");
    // Changing the specialist is a move too.
    sqlite.exec("INSERT INTO employees(id,full_name,position,is_active) VALUES('e2','Второй','Подолог',1)");
    sqlite.exec("INSERT INTO appointments(id,client_id,employee_id,branch_id,starts_at,ends_at,status,total_amount) VALUES('b1','c1','e2','branch','2026-03-01T04:15:00.000Z','2026-03-01T04:45:00.000Z','SCHEDULED',1000)");
    expect(() => sqlite.exec("UPDATE appointments SET employee_id = 'e1' WHERE id = 'b1'")).toThrow("CRM_SLOT_UNAVAILABLE");
    // Reactivating a cancelled row that overlaps an active one is blocked, a non-overlapping one is allowed.
    sqlite.exec("UPDATE appointments SET starts_at = '2026-03-01 04:40:00', ends_at = '2026-03-01 05:40:00' WHERE id = 'a3'");
    expect(() => sqlite.exec("UPDATE appointments SET status = 'SCHEDULED' WHERE id = 'a3'")).toThrow("CRM_SLOT_UNAVAILABLE");
    sqlite.exec("UPDATE appointments SET starts_at = '2026-03-01 08:00:00', ends_at = '2026-03-01 09:00:00' WHERE id = 'a3'");
    sqlite.exec("UPDATE appointments SET status = 'SCHEDULED' WHERE id = 'a3'");
    // Fresh inserts into an occupied interval remain impossible.
    expect(() => sqlite.exec("INSERT INTO appointments(id,client_id,employee_id,branch_id,starts_at,ends_at,status,total_amount) VALUES('a4','c1','e1','branch','2026-03-01T04:45:00.000Z','2026-03-01T05:15:00.000Z','SCHEDULED',1000)")).toThrow("CRM_SLOT_UNAVAILABLE");
    sqlite.close();
  });
  it("delivers the cancellation reason in the Telegram template and keeps data untouched", () => {
    const sqlite = new DatabaseSync(":memory:");
    applyUpTo(sqlite, "0010");
    seedLegacy(sqlite);
    applyOnly(sqlite, ["0011"]);
    const before = sqlite.prepare("SELECT body FROM notification_templates WHERE template_key = 'BOOKING_CANCELLED'").get()?.body as string;
    expect(before).not.toContain("{message}");
    const rowsBefore = sqlite.prepare("SELECT id, starts_at, ends_at, status FROM appointments ORDER BY id").all();
    applyOnly(sqlite, ["0012"]);
    const after = sqlite.prepare("SELECT body FROM notification_templates WHERE template_key = 'BOOKING_CANCELLED'").get()?.body as string;
    expect(after).toContain("{message}");
    expect(after).toContain("{date}");
    expect(sqlite.prepare("SELECT id, starts_at, ends_at, status FROM appointments ORDER BY id").all()).toEqual(rowsBefore);
    expect(sqlite.prepare("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'trigger' AND name = 'appointment_overlap_update'").get()?.value).toBe(1);
    // Re-applying is safe (DROP IF EXISTS + idempotent UPDATE).
    applyOnly(sqlite, ["0012"]);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });
});
