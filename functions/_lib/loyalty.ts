export function loyaltyAwardStatement(db: D1Database, appointmentId: string) {
  return db.prepare(`INSERT OR IGNORE INTO loyalty_transactions (id, client_id, appointment_id, points, kind, description)
    SELECT ?, a.client_id, a.id, CAST(MAX(0, a.total_amount) / 1000 AS INTEGER) * MAX(0, os.loyalty_points_per_1000), 'EARN', 'Бонус за завершённый приём'
    FROM appointments a CROSS JOIN organization_settings os
    WHERE a.id = ? AND a.status = 'COMPLETED' AND os.id = 1 AND a.total_amount >= 1000 AND os.loyalty_points_per_1000 > 0`)
    .bind(crypto.randomUUID(), appointmentId);
}
