export async function awardLoyaltyPoints(db: D1Database, appointmentId: string, clientId: string, amount: number) {
  const settings = await db.prepare("SELECT loyalty_points_per_1000 AS pointsPer1000 FROM organization_settings WHERE id = 1").first<{ pointsPer1000: number }>();
  const points = Math.floor(Math.max(0, amount) / 1000) * Math.max(0, Number(settings?.pointsPer1000 ?? 1));
  if (points <= 0) return 0;
  const transactionId = crypto.randomUUID();
  const inserted = await db.prepare("INSERT OR IGNORE INTO loyalty_transactions (id, client_id, appointment_id, points, kind, description) VALUES (?, ?, ?, ?, 'EARN', ?)").bind(transactionId, clientId, appointmentId, points, "Бонус за завершённый приём").run();
  if (!inserted.success || inserted.meta.changes === 0) return 0;
  await db.prepare("INSERT OR IGNORE INTO loyalty_accounts (client_id, points_balance, lifetime_points) VALUES (?, 0, 0)").bind(clientId).run();
  await db.prepare("UPDATE loyalty_accounts SET points_balance = points_balance + ?, lifetime_points = lifetime_points + ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ?").bind(points, points, clientId).run();
  return points;
}
