import Decimal from "decimal.js";

import type { CrmEnv } from "./env";
import { newId } from "./http";

export const inboundMovementTypes = new Set(["PURCHASE", "MANUAL_IN", "RETURN"]);
export const outboundMovementTypes = new Set(["SERVICE_USAGE", "MANUAL_OUT", "SALE", "WRITE_OFF"]);

export type InventoryWarning = {
  productId: string;
  productName: string;
  requiredQuantity: number;
  availableQuantity: number;
  message: string;
};

export function stockBalanceExpression(movementAlias = "sm") {
  return `COALESCE(SUM(CASE WHEN ${movementAlias}.direction = 'IN' THEN ${movementAlias}.quantity ELSE -${movementAlias}.quantity END), 0)`;
}

type ConsumableRow = {
  appointmentId: string;
  serviceId: string;
  branchId: string;
  productId: string;
  productName: string;
  productUnit: string;
  quantity: number;
  purchasePrice: number;
  availableQuantity: number;
  existingConsumption: number;
};

export async function prepareAppointmentConsumption(db: D1Database, appointmentId: string) {
  const rows = await db.prepare(`
    SELECT a.id AS appointmentId, a.branch_id AS branchId, aps.service_id AS serviceId,
      sc.product_id AS productId, p.name AS productName, p.unit AS productUnit,
      aps.quantity * sc.quantity AS quantity, p.purchase_price AS purchasePrice,
      COALESCE((SELECT SUM(CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END)
        FROM stock_movements sm WHERE sm.product_id = p.id AND sm.branch_id = a.branch_id), 0) AS availableQuantity,
      EXISTS (SELECT 1 FROM inventory_consumptions ic
        WHERE ic.appointment_id = a.id AND ic.service_id = aps.service_id AND ic.product_id = sc.product_id) AS existingConsumption
    FROM appointments a
    INNER JOIN appointment_services aps ON aps.appointment_id = a.id
    INNER JOIN service_consumables sc ON sc.service_id = aps.service_id AND sc.active = 1
      AND (sc.branch_id = a.branch_id OR (sc.branch_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM service_consumables scoped
        WHERE scoped.service_id = sc.service_id AND scoped.product_id = sc.product_id
          AND scoped.branch_id = a.branch_id AND scoped.active = 1
      )))
    INNER JOIN products p ON p.id = sc.product_id AND p.is_active = 1
    WHERE a.id = ?
    ORDER BY p.name, aps.service_id
  `).bind(appointmentId).all<ConsumableRow>();

  const consumables = (rows.results ?? []).filter((row) => !row.existingConsumption);
  const requiredByProduct = new Map<string, number>();
  for (const row of consumables) requiredByProduct.set(row.productId, (requiredByProduct.get(row.productId) ?? 0) + Number(row.quantity || 0));

  const warnings: InventoryWarning[] = [];
  const statements: D1PreparedStatement[] = [];
  const sufficient = new Set<string>();
  for (const [productId, required] of requiredByProduct) {
    const row = consumables.find((item) => item.productId === productId);
    const available = Number(row?.availableQuantity ?? 0);
    if (available + 0.000001 < required) {
      const warning = {
        productId,
        productName: row?.productName ?? "Материал",
        requiredQuantity: required,
        availableQuantity: Math.max(0, available),
        message: `Недостаточно материала «${row?.productName ?? productId}»: нужно ${required}, доступно ${Math.max(0, available)}.`,
      } satisfies InventoryWarning;
      warnings.push(warning);
      for (const item of consumables.filter((candidate) => candidate.productId === productId)) {
        statements.push(db.prepare("INSERT OR IGNORE INTO inventory_issues (id, appointment_id, service_id, product_id, required_quantity, available_quantity, message) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(newId(), appointmentId, item.serviceId, item.productId, Number(item.quantity), Math.max(0, available), warning.message));
      }
    } else {
      sufficient.add(productId);
    }
  }

  for (const row of consumables) {
    if (!sufficient.has(row.productId)) continue;
    const quantity = new Decimal(row.quantity || 0);
    const unitCost = new Decimal(row.purchasePrice || 0);
    const totalCost = quantity.mul(unitCost);
    const idempotencyKey = `appointment:${appointmentId}:service:${row.serviceId}:product:${row.productId}`;
    const movementId = `movement-${idempotencyKey.replaceAll(":", "-")}`;
    statements.push(db.prepare(`INSERT OR IGNORE INTO stock_movements
      (id, product_id, branch_id, movement_type, direction, quantity, unit_price, total_cost, occurred_at, source, appointment_id, idempotency_key, comment)
      VALUES (?, ?, ?, 'SERVICE_USAGE', 'OUT', ?, ?, ?, CURRENT_TIMESTAMP, 'APPOINTMENT_COMPLETION', ?, ?, ?)`)
      .bind(movementId, row.productId, row.branchId, quantity.toNumber(), unitCost.toNumber(), totalCost.toNumber(), appointmentId, idempotencyKey, `Автоматическое списание по услуге ${row.serviceId}`));
    statements.push(db.prepare(`INSERT OR IGNORE INTO inventory_consumptions
      (id, appointment_id, service_id, product_id, stock_movement_id, quantity, unit_cost, total_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`consumption-${idempotencyKey.replaceAll(":", "-")}`, appointmentId, row.serviceId, row.productId, movementId, quantity.toNumber(), unitCost.toNumber(), totalCost.toNumber()));
    statements.push(db.prepare("UPDATE inventory_issues SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP WHERE appointment_id = ? AND service_id = ? AND product_id = ? AND status = 'OPEN'")
      .bind(appointmentId, row.serviceId, row.productId));
  }

  return { statements, warnings };
}

export async function inventorySummary(db: D1Database, branchId?: string | null) {
  const filters = ["p.is_active = 1"];
  const bindings: string[] = [];
  if (branchId) {
    filters.push("(p.branch_id IS NULL OR p.branch_id = ?)");
    bindings.push(branchId);
  }
  const result = await db.prepare(`
    SELECT p.id, p.name, p.sku, p.unit, p.purchase_price AS purchasePrice, p.sale_price AS salePrice,
      p.min_stock AS minStock, p.optimal_stock AS optimalStock, p.branch_id AS branchId,
      pc.name AS categoryName, s.name AS supplierName,
      ${stockBalanceExpression()} AS currentStock,
      CASE WHEN ${stockBalanceExpression()} <= p.min_stock THEN 1 ELSE 0 END AS lowStock
    FROM products p
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN stock_movements sm ON sm.product_id = p.id ${branchId ? "AND sm.branch_id = ?" : ""}
    WHERE ${filters.join(" AND ")}
    GROUP BY p.id
    ORDER BY lowStock DESC, p.name ASC
  `).bind(...(branchId ? [branchId, ...bindings] : bindings)).all();
  return result.results ?? [];
}

export function inventoryEnvironment(env: CrmEnv) {
  return env;
}
