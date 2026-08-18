import { describe, expect, it } from "vitest";

import { addMonths, buildMonthGrid, buildWeekRow, isSameIsoMonth } from "./date-grid";

describe("buildMonthGrid", () => {
  it("returns 42 cells covering full leading/trailing weeks", () => {
    const grid = buildMonthGrid(2026, 7); // August 2026
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-07-26"); // August 1 2026 is a Saturday -> week starts Sunday July 26
    expect(grid).toContain("2026-08-01");
    expect(grid).toContain("2026-08-31");
  });

  it("flags which cells belong to the target month", () => {
    const grid = buildMonthGrid(2026, 7);
    const inMonthCount = grid.filter((iso) => isSameIsoMonth(iso, 2026, 7)).length;
    expect(inMonthCount).toBe(31);
  });
});

describe("buildWeekRow", () => {
  it("returns the 7 days of the week containing the given date", () => {
    const week = buildWeekRow("2026-08-19");
    expect(week).toHaveLength(7);
    expect(week[0]).toBe("2026-08-16");
    expect(week[6]).toBe("2026-08-22");
  });
});

describe("addMonths", () => {
  it("rolls over year boundaries in both directions", () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
});
