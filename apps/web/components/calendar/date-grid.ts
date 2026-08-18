/** Pure date-grid helpers for the calendar's month view. Kept dependency-free and tested. */

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isSameIsoMonth(iso: string, year: number, month: number): boolean {
  const [y, m] = iso.split("-").map(Number);
  return y === year && m === month + 1;
}

/**
 * Returns a 42-cell (6x7) grid of ISO date strings covering the given month,
 * padded with the trailing/leading days of adjacent months so every week is
 * complete. Weeks start on Sunday.
 */
export function buildMonthGrid(year: number, month: number): string[] {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const startOffset = firstOfMonth.getUTCDay();
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const cellDate = new Date(gridStart);
    cellDate.setUTCDate(cellDate.getUTCDate() + index);
    return toIsoDate(cellDate);
  });
}

/** Returns the 7 ISO dates (Sunday-Saturday) for the week containing `iso`. */
export function buildWeekRow(iso: string): string[] {
  const date = new Date(`${iso}T00:00:00Z`);
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return Array.from({ length: 7 }, (_, index) => {
    const cellDate = new Date(start);
    cellDate.setUTCDate(cellDate.getUTCDate() + index);
    return toIsoDate(cellDate);
  });
}

export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function formatMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month, 1)));
}

export function formatDayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}
