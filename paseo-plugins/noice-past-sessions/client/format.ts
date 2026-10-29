const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function localMidnight(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

type Age = { unit: "now" } | { unit: "min" | "h" | "d" | "wk" | "mo" | "y"; count: number };

function age(iso: string, now: number): Age {
  const then = Date.parse(iso);
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return { unit: "now" };
  if (elapsed < HOUR) return { unit: "min", count: Math.floor(elapsed / MINUTE) };
  // Rounded: a DST change makes one calendar day 23 or 25 hours long.
  const days = Math.max(0, Math.round((localMidnight(now) - localMidnight(then)) / DAY));
  if (days === 0 || elapsed < 6 * HOUR) return { unit: "h", count: Math.floor(elapsed / HOUR) };
  if (days < 14) return { unit: "d", count: days };
  if (days < 60) return { unit: "wk", count: Math.floor(days / 7) };
  if (days < 365) return { unit: "mo", count: Math.floor(days / 30) };
  return { unit: "y", count: Math.floor(days / 365) };
}

/**
 * Last activity: minutes and hours (same day, or under 6 h), then local calendar days.
 * Long: "just now", "5 min ago", "3 h ago", "yesterday", "4 d ago", "3 wk ago", "5 mo ago", "2 y ago".
 * Short (compact rows): "now", "5m", "3h", "1d", "4d", "3w", "5mo", "2y".
 */
export function relativeTime(iso: string, now: number, short = false): string {
  const value = age(iso, now);
  if (value.unit === "now") return short ? "now" : "just now";
  if (short) return `${value.count}${value.unit === "min" ? "m" : value.unit === "wk" ? "w" : value.unit}`;
  if (value.unit === "d" && value.count === 1) return "yesterday";
  return `${value.count} ${value.unit} ago`;
}

/** Local "2026-10-19 12:41". Built by hand: Intl coverage differs between Hermes and browsers. */
export function absoluteTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A chip for rows outside `folder`: its last path segment, and the full `~/…` path for the tooltip. */
export function folderChip(cwd: string, folder: string, home: string): { label: string; path: string } | null {
  if (cwd === folder) return null;
  const label = cwd.replace(/\/+$/, "").split("/").pop() || cwd;
  return { label, path: tildify(cwd, home) };
}

/** An absolute home path becomes its `~/…` form. */
export function tildify(target: string, home: string): string {
  if (!home) return target;
  if (target === home) return "~";
  return target.startsWith(`${home}/`) ? `~${target.slice(home.length)}` : target;
}
