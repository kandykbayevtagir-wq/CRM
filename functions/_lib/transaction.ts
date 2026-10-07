// D1 batch rolls back the entire operation if the assertion fails.
// Only trusted, static SQL predicates are accepted from domain services.
export function assertUnchanged(db: D1Database, table: "appointments" | "payroll_periods", id: string, revision: number) {
  const key = crypto.randomUUID();
  return [
    db.prepare(`INSERT INTO mutation_guards (id, passed) SELECT ?, EXISTS(SELECT 1 FROM ${table} WHERE id = ? AND revision = ?)`).bind(key, id, revision),
    db.prepare("DELETE FROM mutation_guards WHERE id = ?").bind(key),
  ];
}
