function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function nationalDigits(value: string) {
  const trimmed = value.trim();
  const digits = digitsOnly(trimmed);
  if (!digits) return "";
  if (trimmed.startsWith("+7") && digits.startsWith("7")) return digits.slice(1);
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits;
}

/** Canonical KZ digits for storage: 77001234567. */
export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const digits = digitsOnly(trimmed);
  if (trimmed.startsWith("+7") && digits.startsWith("7")) {
    const national = digits.slice(1);
    return national.length <= 10 ? (national.length === 10 ? `7${national}` : national) : `7${national}`;
  }
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith("7")) return digits;
  const national = nationalDigits(value);
  return national.length === 10 ? `7${national}` : national;
}

export function getKzNationalDigits(value: string): string {
  return nationalDigits(value);
}

export function toKzE164(value: string): string {
  const normalized = normalizePhone(value);
  return normalized.length === 11 ? `+${normalized}` : "";
}

export function formatKzPhone(value: string): string {
  const digits = nationalDigits(value).slice(0, 10);
  if (!digits) return "+7 ";
  const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)].filter(Boolean);
  return `+7 ${groups.join(" ")}`;
}

export function isValidPhone(value: string): boolean {
  const normalized = normalizePhone(value);
  return normalized.length === 11 && normalized.startsWith("7");
}
