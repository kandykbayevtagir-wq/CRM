export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && digits.startsWith("7")) return digits;
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  return digits;
}

export function isValidPhone(value: string): boolean {
  const normalized = normalizePhone(value);
  return normalized.length >= 10 && normalized.length <= 15;
}
