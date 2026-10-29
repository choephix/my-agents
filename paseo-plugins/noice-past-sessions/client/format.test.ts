import { describe, expect, it } from "vitest";
import { absoluteTime, folderChip, relativeTime, tildify } from "./format";

// Local wall-clock times, so the expectations hold in any time zone.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

describe("relativeTime", () => {
  const now = at(19, 13, 20);

  it("uses minutes and hours for recent activity", () => {
    expect(relativeTime(iso(now - 59_000), now)).toBe("just now");
    expect(relativeTime(iso(at(19, 13, 15)), now)).toBe("5 min ago");
    expect(relativeTime(iso(at(19, 1, 0)), now)).toBe("12 h ago");
    // Before midnight but under 6 h ago still reads as hours.
    expect(relativeTime(iso(at(18, 23, 0)), at(19, 2, 0))).toBe("3 h ago");
  });

  it("counts calendar days, so the day before yesterday is not 'yesterday'", () => {
    expect(relativeTime(iso(at(18, 9, 0)), now)).toBe("yesterday");
    expect(relativeTime(iso(at(17, 19, 14)), now)).toBe("2 d ago");
    expect(relativeTime(iso(at(1, 12, 0)), now)).toBe("2 wk ago");
    expect(relativeTime(iso(new Date(2026, 6, 19).getTime()), now)).toBe("3 mo ago");
    expect(relativeTime(iso(new Date(2024, 6, 19).getTime()), now)).toBe("2 y ago");
  });

  it("has a short form for compact rows", () => {
    expect(relativeTime(iso(now - 59_000), now, true)).toBe("now");
    expect(relativeTime(iso(at(19, 13, 12)), now, true)).toBe("8m");
    expect(relativeTime(iso(at(19, 7, 0)), now, true)).toBe("6h");
    expect(relativeTime(iso(at(18, 9, 0)), now, true)).toBe("1d");
    expect(relativeTime(iso(at(1, 12, 0)), now, true)).toBe("2w");
    expect(relativeTime(iso(new Date(2026, 6, 19).getTime()), now, true)).toBe("3mo");
  });

  it("treats clock skew into the future as now", () => {
    expect(relativeTime(iso(now + 10_000), now)).toBe("just now");
  });
});

describe("absoluteTime", () => {
  it("prints local date and minute", () => {
    expect(absoluteTime(iso(at(9, 7, 5)))).toBe("2026-10-09 07:05");
  });
});

describe("folderChip", () => {
  it("marks only rows outside the folder, with the last segment and the full ~ path", () => {
    expect(folderChip("/home/user/index", "/home/user/index", "/home/user")).toBeNull();
    expect(folderChip("/home/user/.herdr/worktrees/acme-app/acme-worktree", "/home/user/workspace/acme-app", "/home/user")).toEqual({
      label: "acme-worktree",
      path: "~/.herdr/worktrees/acme-app/acme-worktree",
    });
    expect(folderChip("/mnt/vault/", "/home/user/index", "/home/user")).toEqual({ label: "vault", path: "/mnt/vault/" });
  });
});

describe("tildify", () => {
  it("shortens only real home children", () => {
    expect(tildify("/home/user", "/home/user")).toBe("~");
    expect(tildify("/home/user2/a", "/home/user")).toBe("/home/user2/a");
  });
});
