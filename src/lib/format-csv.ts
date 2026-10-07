// Spreadsheet programs interpret formula prefixes even inside quoted CSV cells.
export function csvValue(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  const prefix = text.trimStart().split("").find((character) => character.charCodeAt(0) > 31);
  if (typeof value === "string" && prefix && "=+@-".includes(prefix)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
