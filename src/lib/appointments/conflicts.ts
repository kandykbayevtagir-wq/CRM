export function rangesOverlap(startA: string | number | Date, endA: string | number | Date, startB: string | number | Date, endB: string | number | Date): boolean {
  const aStart = new Date(startA).getTime();
  const aEnd = new Date(endA).getTime();
  const bStart = new Date(startB).getTime();
  const bEnd = new Date(endB).getTime();
  return Number.isFinite(aStart) && Number.isFinite(aEnd) && Number.isFinite(bStart) && Number.isFinite(bEnd) && aStart < bEnd && bStart < aEnd;
}
