const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Local time a chat fell asleep: "14:20" today, "Mon 14:20" within the last week, "Oct 12" before that. */
export function formatSleptAt(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return time;
  if (days < 7) return `${DAYS[at.getDay()]} ${time}`;
  return `${MONTHS[at.getMonth()]} ${at.getDate()}`;
}

/**
 * Paseo caps a composer pill at 160 px (about 110 px of 12 px text), so the label is the terse
 * "14:20 · Wake" next to the 💤 icon; the tooltip carries the full sentence.
 */
export function pillText(sleptAt: string | null, now?: Date): { label: string; title: string } {
  const since = sleptAt ? formatSleptAt(sleptAt, now) : "";
  return {
    label: since ? `${since} · Wake` : "Asleep · Wake",
    title: `${since ? `Asleep since ${since}` : "Asleep"}. Wake. Sending a message also wakes it.`,
  };
}

/** Freed memory, rounded: "~1.8 GB"; under 0.1 GB shows in MB. */
export function formatFreed(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 95_000_000) return `~${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
  return `~${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
