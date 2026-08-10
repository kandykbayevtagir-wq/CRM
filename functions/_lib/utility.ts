import { nonNegativeNumber } from "./validation";

export function utilityValues(body: Record<string, unknown>, existing?: Record<string, unknown>) {
  const previous = nonNegativeNumber(body.previousMeterValue ?? existing?.previous_meter_value, "Предыдущее показание");
  const current = nonNegativeNumber(body.currentMeterValue ?? existing?.current_meter_value, "Текущее показание");
  const tariff = nonNegativeNumber(body.tariff ?? existing?.tariff, "Тариф");
  const fixedFee = nonNegativeNumber(body.fixedFee ?? existing?.fixed_fee, "Фиксированная часть");
  if (previous === null || current === null || tariff === null || fixedFee === null || current < previous) return null;
  const consumption = current - previous;
  return { previous, current, tariff, fixedFee, consumption, amount: consumption * tariff + fixedFee };
}
