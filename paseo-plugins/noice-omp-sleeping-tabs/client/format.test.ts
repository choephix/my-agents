import { describe, expect, test } from "vitest";
import { formatFreed, formatSleptAt, pillText } from "./format";

const local = (day: number, hours: number, minutes: number) => new Date(2026, 9, day, hours, minutes).toISOString();
const now = new Date(2026, 9, 23, 15, 0); // Friday

describe("formatSleptAt", () => {
  test("today shows the time", () => expect(formatSleptAt(local(23, 14, 5), now)).toBe("14:05"));
  test("earlier this week shows the weekday", () => expect(formatSleptAt(local(19, 9, 30), now)).toBe("Mon 09:30"));
  test("yesterday late at night is not today", () => expect(formatSleptAt(local(22, 23, 59), now)).toBe("Thu 23:59"));
  test("a week or more shows the date", () => expect(formatSleptAt(local(12, 8, 0), now)).toBe("Oct 12"));
});

describe("pillText", () => {
  test("with a sleep time", () => expect(pillText(local(23, 14, 20), now)).toEqual({
    label: "14:20 · Wake",
    title: "Asleep since 14:20. Wake. Sending a message also wakes it.",
  }));
  test("closed by a restart has no time", () => expect(pillText(null, now).label).toBe("Asleep · Wake"));
});

describe("formatFreed", () => {
  test("nothing measured", () => expect(formatFreed(0)).toBe(""));
  test("small amounts in MB", () => expect(formatFreed(26_200_000)).toBe("~26 MB"));
  test("one agent", () => expect(formatFreed(269_742_080)).toBe("~0.3 GB"));
  test("many agents", () => expect(formatFreed(3_480_000_000)).toBe("~3.5 GB"));
});
