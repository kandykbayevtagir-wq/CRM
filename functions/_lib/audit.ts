import type { AuthUser } from "./auth";
import { newId } from "./http";

type AuditPayload = Record<string, unknown> | null;

export function auditStatement(
  db: D1Database,
  actor: AuthUser | null,
  entityType: string,
  entityId: string,
  action: string,
  before: AuditPayload = null,
  after: AuditPayload = null,
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(newId(), actor?.id ?? null, entityType, entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);
}
