"use client";
import { useLayoutEffect, useRef, type TableHTMLAttributes } from "react";

/** Keep a semantic desktop table; label each value in the mobile card layout. */
export function ResponsiveTable({ children, className = "data-table", ...props }: TableHTMLAttributes<HTMLTableElement>) {
  const ref = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const labels = Array.from(table.tHead?.rows[0]?.cells ?? []).map((cell) => cell.textContent?.trim() || "Действия");
    for (const body of table.tBodies) for (const row of body.rows) {
      let index = 0;
      for (const cell of row.cells) {
        if (cell.colSpan === 1) cell.dataset.label = labels[index] || "";
        index += cell.colSpan;
      }
    }
  }, [children]);
  return <table ref={ref} className={`${className} responsive-table`} {...props}>{children}</table>;
}
