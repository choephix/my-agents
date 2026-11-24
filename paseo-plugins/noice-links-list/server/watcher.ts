import { type FSWatcher, readdirSync, statSync, watch } from "node:fs";
import path from "node:path";

export interface WatchTargets {
  /** Transcript `.jsonl` files to watch directly. */
  files: ReadonlySet<string>;
  /** Sub-agent folders to watch (plus one level of nested OMP sub-agent folders). */
  dirs: ReadonlySet<string>;
}

function readSubdirs(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!(entry.isDirectory() || entry.isSymbolicLink())) continue;
    const abs = path.join(dir, entry.name);
    try {
      if (statSync(abs).isDirectory()) out.push(abs);
    } catch {
      // Vanished or broken symlink.
    }
  }
  return out;
}

/**
 * Watches a dynamic set of transcript files and sub-agent directories with debounced change
 * notifications. Holds zero `FSWatcher`s and zero timers when empty or after `close()`.
 */
export class TranscriptWatcher {
  readonly #debounceMs: number;
  readonly #onChange: () => void;
  readonly #watchers = new Map<string, FSWatcher>();
  #dirs = new Set<string>();
  #files = new Set<string>();
  #timer?: ReturnType<typeof setTimeout>;
  #closed = false;

  constructor(onChange: () => void, debounceMs = 200) {
    this.#onChange = onChange;
    this.#debounceMs = debounceMs;
  }

  get watcherCount(): number {
    return this.#watchers.size;
  }

  /** Replaces the watched file and directory sets, keeping unchanged watchers open. */
  setTargets(targets: WatchTargets): void {
    if (this.#closed) return;
    this.#files = new Set(targets.files);
    this.#dirs = new Set(targets.dirs);
    this.#sync();
  }

  /** Schedules a debounced change notification. */
  trigger(): void {
    if (this.#closed || this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (!this.#closed) this.#onChange();
    }, this.#debounceMs);
  }

  close(): void {
    this.#closed = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    for (const watcher of this.#watchers.values()) watcher.close();
    this.#watchers.clear();
    this.#files.clear();
    this.#dirs.clear();
  }

  #desired(): Map<string, "file" | "dir"> {
    const desired = new Map<string, "file" | "dir">();
    for (const file of this.#files) desired.set(file, "file");
    for (const dir of this.#dirs) {
      desired.set(dir, "dir");
      for (const sub of readSubdirs(dir)) desired.set(sub, "dir");
    }
    return desired;
  }

  #sync(): void {
    const desired = this.#desired();
    for (const [target, watcher] of this.#watchers) {
      if (desired.has(target)) continue;
      watcher.close();
      this.#watchers.delete(target);
    }
    for (const [target, kind] of desired) {
      if (this.#watchers.has(target)) continue;
      try {
        const watcher = watch(target, (_event, filename) => {
          const name = filename?.toString();
          if (kind === "dir") {
            if (name && name.startsWith(".")) return;
            // New sub-agent folder may have appeared; resync watchers.
            this.#sync();
          }
          this.trigger();
        });
        watcher.on("error", () => {
          watcher.close();
          this.#watchers.delete(target);
        });
        this.#watchers.set(target, watcher);
      } catch {
        // File or directory not created yet or already removed.
      }
    }
  }
}
