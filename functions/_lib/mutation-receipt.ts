import { json, newId, stringValue, type JsonRecord } from "./http";
import { HttpError } from "./security";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Receipt and effects commit together. Retrying an ambiguous response cannot duplicate money. */
export async function mutationReceipt(db: D1Database, actorId: string, operation: string, body: JsonRecord) {
  const key = stringValue(body, "idempotencyKey") || newId();
  if (key.length > 128 || (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== "string")) throw new HttpError(400, "INVALID_OPERATION_KEY", "Некорректный ключ операции");
  const payload = Object.fromEntries(Object.entries(body).filter(([name]) => name !== "idempotencyKey"));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(payload))));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const previous = async () => {
    const row = await db.prepare("SELECT request_hash AS hash, response_json AS response, response_status AS status FROM mutation_receipts WHERE actor_id = ? AND operation = ? AND idempotency_key = ?")
      .bind(actorId, operation, key).first<{ hash: string; response: string; status: number }>();
    if (!row) return null;
    if (row.hash !== hash) throw new HttpError(409, "OPERATION_KEY_REUSED", "Этот ключ уже использован для другой операции. Обновите форму.");
    return json({ ...JSON.parse(row.response), replayed: true }, row.status);
  };
  return {
    replay: await previous(),
    async commit(statements: D1PreparedStatement[], response: JsonRecord, status = 201) {
      try {
        await db.batch([
          db.prepare("INSERT INTO mutation_receipts(actor_id, operation, idempotency_key, request_hash, response_json, response_status) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(actorId, operation, key, hash, JSON.stringify(response), status),
          ...statements,
        ]);
      } catch (error) {
        const replay = await previous();
        if (replay) return replay;
        throw error;
      }
      return json(response, status);
    },
  };
}
